---
title: "Reverse Engineering LockBit 3.0 Ransomware — From Encrypted Binary to Full Dissection"
description: A complete, A-to-Z reverse engineering analysis of a LockBit 3.0 (LockBit Black) ransomware sample — covering PE structure, encrypted sections, dynamic API resolution, polymorphic trampolines, modified RC4/Salsa20 cryptography, multi-threaded encryption, the leaked builder toolkit, and every anti-analysis trick baked into the binary.
date: 2026-10-20T18:00:00+05:30
image:
math:
license:
hidden: false
comments: true
draft: false
tags: ["cybersecurity", "malware-analysis", "reverse-engineering", "ransomware", "lockbit", "ghidra", "cryptography", "windows-internals", "infosec"]
categories: ["cybersecurity", "malware-analysis", "reverse-engineering"]
---

A complete, A-to-Z reverse engineering teardown of a **LockBit 3.0** (LockBit Black) ransomware sample — covering PE structure, encrypted sections, dynamic API resolution, polymorphic trampolines, custom cryptography, the leaked builder toolkit, and every anti-analysis trick packed into 146 kilobytes of compiled code.

## Prologue
> **"Control is an illusion. The only thing that's real is the code."**
> — *Elliot Alderson, Mr. Robot*

A ransomware binary is engineered to be opaque. Every string encrypted, every API call hidden, every section entropy-maxed to resist static analysis. The developers assume you won't look past the decoy imports and the noise. But binary analysis is a conversation — you ask the right questions, and the code has no choice but to answer. This post is the full transcript of that conversation with LockBit 3.0.

## Background

### What is LockBit 3.0?

**LockBit** is one of the most prolific Ransomware-as-a-Service (RaaS) operations in history, responsible for thousands of attacks across healthcare, government, finance, and critical infrastructure worldwide. **LockBit 3.0**, also known as **LockBit Black**, was their third-generation encryptor, released mid-2022, and represented a significant technical leap from earlier versions.

What makes LockBit 3.0 especially interesting from a reverse engineering perspective is that its **builder toolkit was leaked** in September 2022 by a disgruntled developer. This leak exposed:
- The **builder** that assembles ransomware binaries from PE templates
- The **key generator** for RSA key pairs
- The **configuration format** that parameterizes every operational aspect
- Five **PE templates** for different deployment scenarios (EXE, DLL, reflective DLL, password-gated variants)

The sample I'm analyzing was built with this leaked toolkit. Having both the binary **and** the builder means I can cross-correlate findings — every design decision visible in the binary can be traced back to its origin in the build pipeline.

### The Sample

| Property | Value |
|----------|-------|
| **SHA-256** | `105912c9995a1d718c5442349d2cc4bb99426f75ff34554cdfd9a7272eeca398` |
| **MD5** | `a5f2eeb4c5cbb2c2ff3b103e304c4a37` |
| **Size** | 150,016 bytes (146.5 KB) |
| **Format** | PE32, i386, Windows GUI subsystem |
| **Compiled** | 2022-09-13 23:30:57 UTC |
| **Linker** | MSVC 14.12 (Visual Studio 2017 15.5+) |
| **Entry Point** | `0x0041946F` (in `.itext` section) |
| **Image Base** | `0x00400000` |

### Tools Used

- **Ghidra** (NSA's reverse engineering framework) — with the MCP bridge for automated decompilation
- **Python** with `pefile` — for PE header parsing and entropy analysis
- **Custom scripts** — for section entropy calculation and string extraction

---

## PE Header Analysis

The PE headers reveal a binary that's been carefully crafted to look benign while hiding its true nature.

### Optional Header

```
Entry Point RVA:    0x0001946F
Image Base:         0x00400000
Section Alignment:  0x1000
File Alignment:     0x0200
OS Version:         5.1 (Windows XP compatibility)
Subsystem:          WINDOWS_GUI (2)
DLL Characteristics: DYNAMIC_BASE | NX_COMPAT | TERMINAL_SERVER_AWARE
```

The **DYNAMIC_BASE** flag means ASLR is enabled — the binary can be loaded at randomized addresses. **NX_COMPAT** marks the stack as non-executable. These are standard modern mitigations, but they're also what you'd expect from a legitimate application. That's the point.

### Characteristics

```
IMAGE_FILE_EXECUTABLE_IMAGE
IMAGE_FILE_32BIT_MACHINE
```

No exports, no TLS callbacks, no resources. The debug directory contains only **POGO** (Profile-Guided Optimization) data with no PDB path — the binary was compiled with PGO for performance, then completely stripped of debug symbols.

---

## Section Layout and Entropy Analysis

This is where the first major red flags appear. The binary has **6 sections**, and two of them have entropy approaching the theoretical maximum of 8.0 — a dead giveaway that they contain encrypted or compressed data.

| Section | Virtual Addr | Virtual Size | Raw Size | Permissions | Entropy | Purpose |
|---------|-------------|-------------|----------|-------------|---------|---------|
| `.text` | `0x00401000` | `0x17D46` | `0x17E00` | R-X | 6.61 | Main code |
| `.itext` | `0x00419000` | `0x0569` | `0x0600` | R-X | 3.04 | RC4 cipher + key derivation |
| `.rdata` | `0x0041A000` | `0x04B2` | `0x0600` | R-- | 3.66 | Import tables (decoy IAT) |
| `.data` | `0x0041B000` | `0xADC8` | `0xA000` | RW- | **7.99** | **ENCRYPTED** — API hashes, strings, runtime data |
| `.pdata` | `0x00426000` | `0x0BE8` | `0x0C00` | RW- | **7.94** | **ENCRYPTED** — aPLib-compressed configuration |
| `.reloc` | `0x00427000` | `0x0FCC` | `0x1000` | R-- | 6.73 | Base relocation table (ASLR) |

A few things stand out:

1. **`.data` at entropy 7.99** — This is effectively indistinguishable from random data. Every string, every API hash table, every runtime buffer is encrypted on disk. Static analysis of this section yields nothing.

2. **`.pdata` at entropy 7.94** — The name `.pdata` normally holds exception handling data on x64, but this is a 32-bit binary. The name is a decoy. This section actually holds the **aPLib-compressed and encrypted ransomware configuration** — the ransom note, kill lists, whitelists, C2 URLs, and the RSA public key. Internally, the builder calls this `.xyz`.

3. **`.itext` at entropy 3.04** — This tiny 1,385-byte section contains the entire cryptographic engine: the modified RC4 cipher, the Feistel key expansion, and the entry point. Low entropy because it's pure code, not data.

4. **The entry point is in `.itext`, not `.text`** — The entry at `0x0041946F` is in the crypto section, not the main code section. The first thing the binary does is run its cryptographic initialization.

---

## The Decoy Import Table

The PE's import table is a masterclass in misdirection. It contains **27 functions** from 3 DLLs:

### KERNEL32.dll (8 imports)
```
GetLastError, GetProcAddress, GetModuleHandleA, GetLocaleInfoW,
FreeLibrary, GetFileAttributesW, GetCommandLineW, GetCommandLineA
```

### USER32.dll (7 imports)
```
LoadMenuW, LoadImageW, CreateDialogParamW, CreateWindowExW,
DefWindowProcW, GetDlgItem, IsDlgButtonChecked
```

### gdi32.dll (10 imports)
```
SetPixel, GetPixel, SelectPalette, SelectObject, GetTextColor,
BitBlt, GetDeviceCaps, CreateSolidBrush, CreateFontW, CreateDIBitmap
```

**None of these are used for ransomware functionality.** The USER32 and GDI32 imports — dialog creation, bitmap manipulation, font rendering — make the binary look like a normal GUI application to automated analysis tools. They're decoys.

The entry point actually **calls each decoy function after initialization completes**. The return values are discarded. The purpose is to make these imports appear "used" in behavioral analysis traces, so automated sandboxes classify the binary as a benign Windows application.

All *real* API calls — `CreateFileW`, `ReadFile`, `WriteFile`, `VirtualAlloc`, `CreateThread`, `NtTerminateProcess`, everything the ransomware actually needs — are resolved at runtime via hash-based dynamic resolution from the encrypted `.data` section. No strings. No static references. Invisible to static analysis.

---

## Execution Flow

The entry point at `0x0041946F` orchestrates a tight, 6-step initialization sequence:

```
Step 1: CALL 0x00419000    ; CRT stub — single RET, no-op
Step 2: CALL 0x0040639C    ; API resolution + trampoline builder
Step 3: CALL 0x00409960    ; Core orchestrator (config decrypt, privilege escalation)
Step 4: CALL 0x004173B4    ; Main ransomware logic (CLI parser, encryption)
Step 5: PUSH 0
        CALL [0x4255C8]    ; ExitProcess (dynamically resolved)
Step 6: ~55 calls to IAT thunks  ; Decoy API calls (dead code after ExitProcess)
```

### Step 1: The CRT That Isn't

The first call goes to `0x00419000`, which is... a single `RET` instruction. LockBit completely bypasses the C Runtime initialization. No `_initterm`, no `_initterm_e`, no global constructor chain. The binary initializes everything it needs manually. This eliminates CRT-dependent detection signatures and reduces the attack surface for analysis.

### Step 2: Building the Shadow Import Table

`0x0040639C` is where the binary comes alive. This function:
1. **Decrypts API hash tables** from the `.data` section using XOR with the master key `0x4803BFC7`
2. **Resolves each DLL** by walking the PEB's `InLoadOrderModuleList` and hashing filenames
3. **Resolves each function** by walking export tables and comparing ROR-13 hashes
4. **Builds polymorphic trampolines** in allocated RWX memory for every resolved function

By the time this function returns, the binary has a complete shadow import table of ~200 API functions, each behind a randomized trampoline. I'll detail the trampoline system later.

### Step 3: Core Orchestrator

`0x00409960` handles the heavy initialization:

```c
void core_orchestrator(void) {
    heap_init();
    decrypt_config();                // XOR decrypt + aPLib decompress .pdata

    if (cfg_language_check) {
        if (check_cis_language())    // 17 CIS locale codes
            ExitProcess(0);          // Abort on CIS systems
    }

    if (!is_admin()) {
        if (os_version > 0x3C) {     // Win Vista+
            uac_bypass();            // COM-based UAC bypass
            WaitForSingleObject(-1); // Wait for elevated re-launch
        }
    }

    mutex_name = generate_mutex();   // From bot UID
    mutex_handle = create_mutex();
    enable_privileges();             // SeDebugPrivilege, SeBackup, etc.

    if (is_elevated()) {
        enum_drives_admin();
        setup_wallpaper();
    }

    write_icon_and_registry();       // .ico drop + DefaultIcon key
    generate_session_keys();         // RSA session key processing
}
```

### Step 4: Main Ransomware Logic

`0x004173B4` parses command-line arguments and executes the payload — mutex checks, process/service killing, shadow copy deletion, multi-threaded file encryption, ransom note deployment, wallpaper change, event log deletion, and self-destruction. This is where the damage happens, and I'll cover it in depth later.

---

## The Master XOR Key: `0x4803BFC7`

This 32-bit constant is the universal obfuscation key. It appears explicitly in the code at **over 30 locations**:

| Usage | How |
|-------|-----|
| **API hash table decryption** | Each DWORD XORed with `0x4803BFC7` to recover DLL/function hashes |
| **String decryption** | Format strings stored as `value ^ 0x4803BFC7`, then bitwise NOT |
| **Trampoline encoding** | Resolved addresses XORed with key in modes 2, 3, and 4 |
| **Sentinel detection** | End-of-table marker `0xCCCCCCCC` checked after XOR |
| **File marker seed** | `0x48D52EBD ^ 0x4803BFC7 = 0x00D6917A` — the initial hash seed |

For example, the format string `"%02X"` is stored as the DWORD `0x10318FE2`. Decryption:
```
0x10318FE2 ^ 0x4803BFC7 = 0x58323025
NOT(0x58323025) → "%02X" (wide-char)
```

This key is trivially extractable from the binary — it's not meant to resist a determined analyst. Its purpose is to defeat **automated string extraction** and **YARA rules** that rely on plaintext signatures.

---

## Dynamic API Resolution

This is the most sophisticated obfuscation layer in the binary. LockBit doesn't call Windows APIs directly — every call goes through a multi-stage pipeline that resolves functions at runtime.

### The Hashing Algorithm

Two ROR-13 additive hash functions are used:

**DLL Name Hash** (Unicode, case-insensitive) at `0x004011D4`:
```c
uint32_t dll_hash(WCHAR* name) {
    uint32_t h = 0;
    while (*name) {
        WCHAR c = *name++;
        if (c >= 'A' && c <= 'Z') c |= 0x20; // tolower
        h = ROR(h, 13);
        h += c;
    }
    return h;
}
```

**API Name Hash** (ASCII, case-sensitive) at `0x00401190`:
```c
uint32_t api_hash(char* name, uint32_t dll_seed) {
    uint32_t h = dll_seed;  // seeded with dll_hash
    while (*name) {
        h = ROR(h, 13);
        h += (uint8_t)*name++;
    }
    return h;
}
```

The final hash is a **compound hash** — `f(function_name, dll_name)`. This means the same function name in different DLLs produces different hashes.

Both hash functions contain **dead instructions** as anti-analysis noise:
```nasm
mov  ecx, 0x30
lea  ecx, [ecx*2+1]  ; ecx = 0x61
add  dh, cl
sub  dh, cl          ; net effect: nothing (nop on dh)
mov  ecx, 0x06
lea  ecx, [ecx*2+1]  ; ecx = 0x0D
ror  edx, cl          ; actual ror 13
```

### DLL Resolution via Filesystem Search

The function at `0x00405C34` finds DLLs by hash, but it doesn't use `LoadLibrary` or `GetModuleHandle` — both are hookable by security software. Instead, it:

1. Reads `KUSER_SHARED_DATA.NtSystemRoot` at `0x7FFE0030` to get the Windows directory
2. Builds the search path `C:\Windows\System32\*.dll`
3. Calls `FindFirstFileW` / `FindNextFileW` to enumerate every DLL
4. Hashes each filename and compares against the target hash
5. Returns a handle when found

This is **filesystem-based DLL discovery** — it avoids every API hook that security tools place on the standard module-loading path.

### PEB Walk for Export Resolution

Once a DLL is loaded, `0x00405AFC` walks the **Process Environment Block** to find exports:

```c
void* resolve_api(uint32_t target_hash) {
    PEB* peb = __readfsdword(0x30);            // fs:[0x30] = PEB
    LIST_ENTRY* head = &peb->Ldr->InLoadOrderModuleList;

    for (entry = head->Flink; entry != head; entry = entry->Flink) {
        LDR_DATA_TABLE_ENTRY* mod = CONTAINING_RECORD(entry);
        byte* base = mod->DllBase;
        IMAGE_EXPORT_DIR* exports = base + PE(base)->ExportDir.VirtualAddress;
        uint32_t dll_seed = ror13_hash_wide(mod->BaseDllName);

        for (i = 0; i < exports->NumberOfNames; i++) {
            char* name = base + AddressOfNames[i];
            if (ror13_hash_ascii(name, dll_seed) == target_hash) {
                uint16_t ordinal = AddressOfNameOrdinals[i];
                void* addr = base + AddressOfFunctions[ordinal];
                if (is_forwarded(addr))
                    addr = resolve_forwarded(addr);
                return addr;
            }
        }
    }
    return NULL;
}
```

This is the classic **shellcode-style PEB walk** — it reads the loader's internal data structures directly, bypassing any API-level interception.

---

## Polymorphic Trampolines

This is where LockBit 3.0 gets genuinely creative. Instead of storing resolved API addresses in a simple function pointer table, every resolved address is wrapped in a **randomly-generated code stub** — a trampoline — allocated in executable memory.

The trampoline builder at `0x00405DB0` supports **5 encoding modes**, chosen randomly per function:

| Mode | Encoding | Machine Code | Behavior |
|------|----------|-------------|----------|
| **0** | ROL | `B8 xx C1 C8 nn FF E0` | `MOV EAX, ROL(addr, n); ROR EAX, n; JMP EAX` |
| **1** | ROR | `B8 xx C1 C0 nn FF E0` | `MOV EAX, ROR(addr, n); ROL EAX, n; JMP EAX` |
| **2** | XOR | `B8 xx 35 C7BF0348 FF E0` | `MOV EAX, addr^key; XOR EAX, key; JMP EAX` |
| **3** | XOR+ROL | `B8 xx C1 C8 nn 35 C7BF0348 FF E0` | `MOV EAX, ROL(addr^key, n); ROR; XOR; JMP` |
| **4** | XOR+ROR | `B8 xx C1 C0 nn 35 C7BF0348 FF E0` | `MOV EAX, ROR(addr^key, n); ROL; XOR; JMP` |

The rotation amount `n` is random (1-8), and the encoding mode is random (0-4). Both are generated by a **hardware PRNG** at `0x004010D4` that uses:

1. **RDRAND** (Intel/AMD hardware RNG, CPUID ECX bit 30) — preferred source
2. **RDSEED** (CPUID leaf 7, EBX bit 18) — fallback
3. **RDTSC** (timestamp counter, two reads XOR-mixed with `ROR/ROL 13`) — final fallback

The output is further processed through a **Numerical Recipes LCG** (`raw * 0x19660D + 0x3C6EF35F`), masked to 27 bits, and bounded to the requested range.

This means **every execution produces completely different trampoline code**. There's no static byte pattern to match. A YARA rule that fires on one run won't fire on the next. Traditional AV signatures are useless.

---

## Cryptographic Internals

The `.itext` section at `0x00419000` — just 1,385 bytes — contains the entire cryptographic engine. It implements a **modified RC4 stream cipher** that deviates from the standard in two critical ways.

### Feistel-Like Key Expansion (`0x004192F4`)

Before the cipher key reaches the KSA, it passes through a **6-round Feistel-like transform**:

```c
void feistel_expand(uint32_t* out, uint32_t* in) {
    for (int rounds = 6; rounds > 0; rounds--) {
        uint32_t w0 = BSWAP(in[0]);
        uint32_t w1 = BSWAP(ROL(in[1], 11));
        uint32_t w2 = BSWAP(ROL(in[2],  9));
        uint32_t w3 = BSWAP(ROL(in[3],  7));

        out[0] = w1 ^ ~ROR(w0, 13);
        out[1] = w2;
        out[2] = w3 ^ ~w2;
        out[3] = ROL(out[2], 5) ^ ~out[2];

        in = out;     // chain: output feeds next round
        out += 4;
    }
}
```

The rotation constants — **13, 11, 9, 7, 5** — decrease by 2 each pair (descending odd primes). The `BSWAP` instructions handle endianness conversion. The `NOT + XOR` mixing creates avalanche effects. This produces 24 expanded DWORDs from 4 input DWORDs.

### Triple-Pass KSA (`0x00419348`)

Standard RC4 initializes its 256-byte S-box with a single pass of 256 iterations. LockBit does **three passes of 768 iterations each** — 2,304 iterations total:

```c
uint32_t rc4_ksa(byte* key1, byte* key2, byte* sbox) {
    // Initialize S-box: S[i] = i
    for (int i = 0; i < 256; i++) sbox[i] = i;

    int j = 0;
    // Pass 1: 768 iterations with key2 (64 bytes)
    for (int i = 0; i < 0x300; i++) {
        j = sbox[(sbox[i & 0xFF] + key2[i % 64] + j) & 0xFF];
        LOCK_XCHG(sbox[i & 0xFF], sbox[j]);  // Atomic swap
    }

    // Pass 2: 768 iterations with key1 (32 bytes)
    for (int i = 0; i < 0x300; i++) {
        j = sbox[(sbox[i & 0xFF] + key1[i % 32] + j) & 0xFF];
        LOCK_XCHG(sbox[i & 0xFF], sbox[j]);
    }

    // Pass 3: 768 iterations with key2 again (64 bytes)
    for (int i = 0; i < 0x300; i++) {
        j = sbox[(sbox[i & 0xFF] + key2[i % 64] + j) & 0xFF];
        LOCK_XCHG(sbox[i & 0xFF], sbox[j]);
    }
    return j;
}
```

Note the `LOCK XCHG` instructions — the `LOCK` prefix is an anti-debugging trick. Under normal execution it's a no-op on single-threaded code, but under a debugger that uses hardware breakpoints on memory access, the atomic lock can cause timing anomalies and breakpoint misses.

### Modified PRGA (`0x0041941C`)

The keystream generation is where LockBit truly departs from RC4. Standard RC4 PRGA outputs `S[(S[i] + S[j]) % 256]`. LockBit uses a **triple-nested S-box lookup**:

```c
void rc4_prga(byte* data, int len, byte* sbox, int j) {
    int i = 0;
    while (len--) {
        j = sbox[(sbox[i] + j) & 0xFF];           // Extra nested lookup
        byte k = sbox[(sbox[sbox[j & 0xFF]] + 1) & 0xFF]; // S[S[S[j]]+1]
        *data++ ^= k;
        LOCK_XCHG(sbox[i], sbox[j]);
        i = (i + 1) & 0xFF;
    }
}
```

The critical difference: `S[S[S[j]]+1]` instead of `S[S[i]+S[j]]`. Two extra dereferences through the S-box, plus a `+1` offset. This means:
- Standard RC4 decryption tools **will not work** on LockBit-encrypted data
- The keystream is non-standard and cannot be attacked with known RC4 cryptanalysis
- This exact modification is shared with **BlackMatter ransomware** — confirming the lineage

### Salsa20 for File Encryption

The actual file contents are encrypted with **Salsa20**, a well-known stream cipher by Daniel J. Bernstein. I confirmed this by the characteristic quarter-round rotation constants in the core loop:
- `ROL 7`, `ROL 9`, `ROL 13` (left rotations)
- `ROR 14` (right rotation, equivalent to ROL 18)

Salsa20 generates a keystream from a **256-bit key + 64-bit nonce + 64-bit block counter**.

### RSA-1024 Key Wrapping

The function at `0x004017C4` implements **1024-bit modular exponentiation** for RSA public-key operations, using:
- Chained `RCL` instructions for 1024-bit left-shift (32 iterations over 32 DWORDs)
- `SBB` chains for 1024-bit subtraction with borrow (trial subtraction of modulus)
- `ADC` chains for conditional 1024-bit addition (add modulus back if borrow)
- SSE `MOVDQA` for 128-byte state copies (16-byte aligned, 8 iterations)

This is the textbook **square-and-multiply** algorithm implemented in x86 assembly over 1024-bit integers.

### The 4-Level Key Hierarchy

The complete encryption key hierarchy:

```
LEVEL 1: RSA-1024 Master Key
         ├── 128 bytes, from keygen.exe, held by attacker
         │
LEVEL 2: Session Key (Bot UID)
         ├── 32 bytes @ 0x425100, from config, Feistel-expanded
         │
LEVEL 3: Nonce Material + Triple-KSA RC4 State
         ├── 24 bytes @ 0x425120, 3×768 iterations, S-box
         │
LEVEL 4: Per-File Salsa20 Key + Nonce
         └── 32-byte key + 8-byte nonce, RDRAND random, unique per file
             └── RSA-wrapped → 128B footer, only attacker can unwrap
```

Without the RSA private key (generated by `keygen.exe` and held exclusively by the attacker), decryption is **computationally infeasible**.

### aPLib Decompression

After the modified RC4 decrypts the `.pdata` section, the result is decompressed using **aPLib v1.1.1** — a well-known LZ-based compression algorithm. The decompressor at `0x00418BA4` uses the characteristic `PUSHA`/`POPA` framing (the aPLib signature) and implements the standard bitstream decoder with literal bytes, short matches, and long matches. This is the **same decompressor found in BlackMatter ransomware**.

---

## Configuration Extraction

The configuration decryptor at `0x00406F10` runs a multi-stage pipeline:

```
.pdata section (entropy 7.94)
    → Modified RC4 decrypt (3×768 KSA, S[S[S[j]]]+1 PRGA)
        → aPLib v1.1.1 LZ decompress
            → Field extraction into global variables
```

The decompressed config has a fixed layout:

| Offset | Size | Contents |
|--------|------|----------|
| `+0x00` | 128 bytes | RSA-1024 public key → `0x424F70` |
| `+0x80` | 32 bytes | Bot UID/key → `0x425100` |
| `+0xA0` | 24 bytes | Settings flags (24 booleans) → `0x425120` |
| `+0xB8` | variable | String offset table → pointers to variable-length data |

The string offset table at `+0xB8` contains relative pointers to:
- Whitelisted folders, files, and extensions
- Kill process list (34 process names)
- Kill service list (14 service names)
- C2 gate URLs
- Ransom note text
- Impersonation accounts (which get an extra XOR decryption pass)

### Operational Settings

The configuration for this sample reveals its intended behavior:

| Setting | Value | Meaning |
|---------|-------|---------|
| `encrypt_mode` | `auto` | Full encryption for small files, partial for large |
| `local_disks` | **true** | Encrypts all local volumes |
| `network_shares` | false | Does not traverse network shares |
| `kill_processes` | **true** | Kills 34 processes that might lock files |
| `kill_services` | **true** | Stops 14 services (VSS, SQL, backup, AV) |
| `kill_defender` | **true** | Attempts to disable Windows Defender |
| `gpo_netspread` | **true** | Spreads via Group Policy Objects in AD |
| `gpo_ps_update` | **true** | Uses PowerShell via GPO for lateral movement |
| `set_wallpaper` | **true** | Changes desktop wallpaper to LockBit branding |
| `set_icons` | **true** | Changes encrypted file icons |
| `print_note` | **true** | Sends ransom note to all connected printers |
| `self_destruct` | **true** | Deletes itself after encryption completes |
| `delete_eventlogs` | **true** | Wipes Windows Event Logs |
| `language_check` | false | Does NOT check CIS locale (encrypts Russian systems too) |
| `send_report` | false | Does not phone home to C2 |

### Kill Lists

**Processes to kill** (34 entries — anything that might lock files):
```
sql, oracle, ocssd, dbsnmp, synctime, agntsvc, isqlplussvc,
xfssvccon, mydesktopservice, ocautoupds, encsvc, firefox,
tbirdconfig, mydesktopqos, ocomm, dbeng50, sqbcoreservice,
excel, infopath, msaccess, mspub, onenote, outlook, powerpnt,
steam, thebat, thunderbird, visio, winword, wordpad, notepad,
calc, wuauclt, onedrive
```

**Services to stop** (14 entries — security and backup):
```
vss, sql, svc$, memtas, mepocs, msexchange, sophos,
veeam, backup, GxVss, GxBlr, GxFWD, GxCVD, GxCIMgr
```

### Whitelists

The binary **skips** certain paths, files, and extensions to keep the system bootable:

**Folders** (18 entries): `$recycle.bin`, `windows`, `boot`, `system volume information`, `tor browser`, `windows.old`, `intel`, `msocache`, `perflogs`, `x64dbg`, etc.

**Extensions** (64 entries): `.exe`, `.dll`, `.sys`, `.lnk`, `.ico`, `.cmd`, `.com`, `.drv`, `.pdb`, `.lock`, `.key`, and other system-critical extensions.

The presence of `x64dbg` in the folder whitelist is a nice touch — it skips the debugger's own directory, which could be interpreted as both "don't break analysis tools" and "don't leave evidence in the debugger's directory."

---

## CIS Language Exclusion

The function at `0x00408088` implements the classic **CIS country check** — a hallmark of ransomware with Russian-speaking operators. It calls `GetUserDefaultUILanguage` and `GetSystemDefaultUILanguage`, then compares each against a hardcoded list of **17 locale codes**:

| Code | Language | Code | Language |
|------|----------|------|----------|
| `0x0419` | Russian | `0x0440` | Kyrgyz |
| `0x0422` | Ukrainian | `0x0442` | Turkmen |
| `0x0423` | Belarusian | `0x0443` | Uzbek (Latin) |
| `0x0428` | Tajik | `0x0444` | Tatar |
| `0x042B` | Armenian | `0x0818` | Romanian (Moldova) |
| `0x042C` | Azerbaijani (Latin) | `0x0819` | Russian (Moldova) |
| `0x0437` | Georgian | `0x082C` | Azerbaijani (Cyrillic) |
| `0x043F` | Kazakh | `0x0843` | Uzbek (Cyrillic) |
| `0x2801` | Arabic (Syria) | | |

If either locale matches, the function returns 1, and the orchestrator calls `ExitProcess(0)` — the ransomware silently exits without encrypting anything.

**However**, in this particular build, `language_check` is set to `false` in the config, so this check is **skipped entirely**. The binary will encrypt Russian systems. This is consistent with a leaked builder being used by an operator who doesn't care about the original developers' "rules."

---

## Command-Line Interface

The function at `0x004173B4` parses command-line arguments using **ROR-13 hash comparison** — the same hashing used for API resolution. Each flag's wide-char hash is compared against pre-stored hashes (XORed with `0x4803BFC7`):

| Flag | Purpose |
|------|---------|
| `-pass <key>` | Required decryption password for password-protected builds |
| `-path <dir>` | Restricts encryption to the specified directory |
| `-safe` | Forces reboot into Windows Safe Mode (with networking), then re-executes — bypasses most security software |
| `-wall` | Sets the LockBit wallpaper without encrypting (testing/intimidation) |
| `-psex` | Enables lateral movement via PsExec |
| `-gspd` | Forces Group Policy-based domain-wide propagation |
| `-gdel` | Deletes the GPO objects created during propagation (cleanup phase) |
| `-del` | Forces immediate self-deletion without encryption |

---

## Multi-Threaded Encryption

The encryption orchestrator at `0x00416F90` spawns **6 parallel threads**:

```
Main Thread (0x416F90)
    ├── Process Killer Thread    (0x40D7E8) — kills 34 processes
    ├── Service Killer Thread    (0x409C34) — stops 14 services
    ├── Shadow Copy Deleter      (0x408F38) — wipes VSS
    ├── Drive Enumerator Thread  (0x407438) — finds FIXED + REMOVABLE drives
    ├── File Encryptor Thread    (0x4077FC) — Salsa20 + RSA
    └── Icon Changer Thread      (0x407E28) — drops .ico, sets DefaultIcon
        │
        ▼
    WaitForSingleObject(INFINITE) — join all threads
        │
        ▼
    Post-Encryption Cleanup:
        Wallpaper change → Ransom note drop →
        Event log wipe → Self-delete (COM ITaskService)
```

The I/O priority is boosted via `SetPriorityClass` before encryption begins. The file encryptor uses I/O completion ports for maximum throughput.

### The Encrypted File Footer

Every encrypted file gets a **132-byte footer** appended:

```
┌────────────────────────────────────────┬──────────────┐
│  RSA-1024 Encrypted Salsa20 Key        │  Marker      │
│  128 bytes (0x80)                      │  4 bytes     │
│  Contains: per-file key + nonce        │  (uint32)    │
└────────────────────────────────────────┴──────────────┘
 offset 0                              +128           +132
```

The **marker** is a 3-round hash with BSWAP between rounds, seeded with `0xD6917A` (derived from `0x48D52EBD ^ 0x4803BFC7`):

```c
uint32_t compute_marker(byte* data, uint32_t size) {
    uint32_t h = hash(data, size, 0xD6917A);
    h = hash(data, size, BSWAP(h));
    h = hash(data, size, BSWAP(h));
    return BSWAP(h);
}
```

Before encrypting a file, the binary reads the last 132 bytes and checks if the marker matches. If it does, the file is **already encrypted** — skip it. This prevents double-encryption, which would make recovery impossible even with the private key.

---

## Defense Evasion and Privilege Escalation

### COM-Based UAC Bypass

If the binary detects it's not running as admin (via `TokenElevationTypeFull` check at `0x0040B5D0`, comparing against `0x12`), it attempts a **COM-based UAC bypass** to re-launch itself elevated. This avoids the UAC prompt dialog entirely.

### Privilege Escalation

The function at `0x0040B664` enables multiple privileges by iterating a hardcoded table and calling `RtlAdjustPrivilege` for each:
- **SeDebugPrivilege** — allows terminating any process
- **SeBackupPrivilege** — allows reading any file regardless of ACLs
- **SeRestorePrivilege** — allows writing any file regardless of ACLs
- **SeTakeOwnershipPrivilege** — allows taking ownership of any object
- **SeSecurityPrivilege** — allows modifying security descriptors

### Self-Deletion

Self-deletion is handled by `0x00416B18` using **COM-based task scheduling** via `ITaskService`. A scheduled task is created that:
1. Waits for the ransomware process to exit
2. Deletes the original binary from disk
3. Deletes the scheduled task itself

This three-stage self-destruct avoids the classic "can't delete yourself while running" problem without needing a batch file or second process.

### GPO-Based Lateral Movement

The function at `0x00413868` handles **Group Policy Object-based network spread**. It:
1. Builds a mutex string by hex-encoding the first 8 bytes of the RSA key
2. Creates a GPO that pushes the ransomware binary to all domain-joined machines
3. Uses PowerShell execution via GPO to launch the binary on remote systems
4. After a configurable delay (`delete_gpo_delay`), cleans up the GPO objects

---

## The Builder Toolkit

The `forTesT-main/` directory contains the **leaked LockBit 3.0 builder toolkit** — the factory that produced this binary.

### `keygen.exe` — RSA Key Generator

| Property | Value |
|----------|-------|
| **SHA-256** | `ea6d4dedd8c85e4a6bb60408a0dc1d56def1f4ad4f069c730dc5431b1c23da37` |
| **Size** | 31,744 bytes |
| **Compiled** | 2022-09-08 23:58:31 UTC |
| **Crypto Library** | MIRACL (big-number arithmetic) |
| **CLI** | `keygen -path Build -pubkey pub.key -privkey priv.key` |

Uses the **MIRACL** library for modular exponentiation, with functions including `powmod`, `bigrand`, `isprime`, `nxprime`, and `ecurve_mult`. Keys are stored in **Base64** encoding.

### `builder.exe` — Ransomware Assembler

| Property | Value |
|----------|-------|
| **SHA-256** | `a736269f5f3a9f2e11dd776e352e1801bc28bb699e47876784b8ef761e0062db` |
| **Size** | 480,768 bytes |
| **Compiled** | 2022-09-13 23:31:18 UTC |
| **PE Templates** | 5 embedded in `.rsrc` section (449 KB total) |

The builder reads `config.json`, parses all operational fields, **aPLib-compresses** the config, patches it into the selected PE template's encrypted sections, injects the RSA public key, and recalculates the PE checksum via `CheckSumMappedFile` + `RtlImageNtHeader`.

### The Build Pipeline

The entire build process is automated by `Build.bat`:

| Step | Command | Output |
|------|---------|--------|
| 1/7 | `keygen -path Build -pubkey pub.key -privkey priv.key` | RSA key pair |
| 2/7 | `builder -type dec -privkey priv.key -config config.json -ofile LB3Decryptor.exe` | Decryptor |
| 3/7 | `builder -type enc -exe -pubkey pub.key -config config.json -ofile LB3.exe` | Ransomware EXE |
| 4/7 | `builder -type enc -exe -pass -pubkey pub.key -config config.json -ofile LB3_pass.exe` | Password-gated EXE |
| 5/7 | `builder -type enc -dll -pubkey pub.key -config config.json -ofile LB3_Rundll32.dll` | DLL variant |
| 6/7 | `builder -type enc -dll -pass -pubkey pub.key -config config.json -ofile LB3_Rundll32_pass.dll` | Password-gated DLL |
| 7/7 | `builder -type enc -ref -pubkey pub.key -config config.json -ofile LB3_ReflectiveDll_DllMain.dll` | Reflective DLL |

### DLL Mode Usage

```
rundll32 LBB_Rundll32_pass.dll,gdll -pass <password>   // Global
rundll32 LBB_Rundll32_pass.dll,sdll -pass <password>   // Safe mode
```

The DLL export name is `encryptor3dll.dll`.

### C2 Reporting Format

After encryption completes, the binary can phone home with:
```json
{
    "bot_version": "%s",
    "bot_id": "%s",
    "bot_company": "%.8x%.8x%.8x%.8x",
    "stat_all_files": "%u",
    "stat_not_encrypted": "%u",
    "stat_size": "%s",
    "execution_time": "%u",
    "start_time": "%u",
    "stop_time": "%u"
}
```

The `bot_company` field is the hex-encoded first 16 bytes of the victim's system identifier.

---

## Cross-Correlation: Builder ↔ Ransomware

Comparing the builder toolkit artifacts with the binary reveals **10 evidence points** that confirm the exact build pipeline:

| Evidence | Builder Side | Ransomware Side |
|----------|-------------|----------------|
| **Compile timestamps** | builder.exe: 2022-09-13 **23:31:18** | LB3.exe: 2022-09-13 **23:30:57** |
| **aPLib compression** | String: `aPLib v1.1.1` | Decompressor at `0x418BA4` |
| **Config fields match** | Parses: `encrypt_mode`, `kill_processes`, etc. | Decrypted at `0x406F10` into globals |
| **Decoy imports** | Template has GDI32/USER32 imports | Same 27 decoy imports in LB3.exe |
| **DLL export name** | String: `encryptor3dll.dll` | DLL variant export |
| **C2 format strings** | 3× duplicated in .rsrc templates | Encrypted in .data, decrypted at runtime |
| **PE checksum** | `CheckSumMappedFile` + `RtlImageNtHeader` | Valid PE checksum in final binary |
| **5 output variants** | 5 "DOS mode" stubs in .rsrc | Build.bat produces 5 distinct binaries |
| **RSA key injection** | `-pubkey pub.key` parameter | 128 bytes at `0x424F70` |
| **Development timeline** | keygen compiled 5 days before builder | Crypto core developed first, then assembler |

The **21-second gap** between the ransomware template compilation (23:30:57) and the builder compilation (23:31:18) confirms they were built in the same MSVC build session — template first, then the tool that patches it.

---

## The Ransom Note

The ransom note embedded in this sample's configuration:

```
~~~ LockBit Black Ransomware Since 2024~~~

>>>> Your data are stolen and encrypted

    Price = 2000 $
    Bitcoin = 328N9mKT6xFe6uTvtpxeKSymgWCbbTGbK2
    Email = jimyjoy139@proton.me

>>>> What guarantees that we will not deceive you?

    We are not a politically motivated group and we do not need
    anything other than your money.

    If you pay, we will provide you the programs for decryption
    and we will delete your data. Life is too short to be sad.
    Be not sad, money, it is only paper.

>>>> Your personal DECRYPTION ID: WERTYFG34A48MK4D6D525F3F372263313

>>>> Warning! Do not DELETE or MODIFY any files, it can lead to
     recovery problems!
>>>> Warning! If you do not pay the ransom we will attack your
     company repeatedly again!
```

This is a **test build** from the leaked toolkit — the $2,000 demand, the generic BTC wallet, and the test C2 domain (`test.white-datasheet.com`) all indicate this wasn't deployed against a real target.

---

## Indicators of Compromise

### File Hashes
| Hash | Value |
|------|-------|
| **SHA-256** | `105912c9995a1d718c5442349d2cc4bb99426f75ff34554cdfd9a7272eeca398` |
| **MD5** | `a5f2eeb4c5cbb2c2ff3b103e304c4a37` |
| **Compile** | 2022-09-13 23:30:57 UTC (`0x632112B1`) |

### Builder Toolkit
| File | SHA-256 |
|------|---------|
| **builder.exe** | `a736269f5f3a9f2e11dd776e352e1801bc28bb699e47876784b8ef761e0062db` |
| **keygen.exe** | `ea6d4dedd8c85e4a6bb60408a0dc1d56def1f4ad4f069c730dc5431b1c23da37` |

### Network Indicators
| Indicator | Value |
|-----------|-------|
| **C2 Domain** | `test.white-datasheet.com` |
| **C2 URLs** | `https://test.white-datasheet.com/`, `http://test.white-datasheet.com/` |
| **BTC Wallet** | `328N9mKT6xFe6uTvtpxeKSymgWCbbTGbK2` |
| **Contact** | `jimyjoy139@proton.me` |

### Static Signatures
| Signature | Value |
|-----------|-------|
| **XOR Key** | `0x4803BFC7` |
| **aPLib Sig** | `PUSHA` at `0x418BA4`, `POPA` at `0x418CEA` |
| **KSA Loop** | `CMP ECX, 0x300` at `0x419397`, `0x4193D0`, `0x419409` |
| **Bot UID** | `31300000000000000000000000000000` |

---

## MITRE ATT&CK Mapping

| Technique | ID | Implementation |
|-----------|-----|---------------|
| Data Encrypted for Impact | T1486 | Multi-threaded Salsa20 file encryption |
| Inhibit System Recovery | T1490 | VSS shadow copy deletion, event log wiping |
| Service Stop | T1489 | Kills VSS, SQL, backup, AV services |
| Process Discovery/Kill | T1057 | Terminates 34 named processes |
| Impair Defenses | T1562 | Disables Windows Defender |
| Indicator Removal | T1070 | Event log deletion, self-destruction |
| Obfuscated Files | T1027 | Encrypted sections, API hashing, trampolines |
| Dynamic Resolution | T1106 | PEB-walking hash-based API resolution |
| Defacement | T1491 | Desktop wallpaper and icon modification |
| Lateral Tool Transfer | T1570 | GPO-based domain propagation |

---

## Complete Function Map

352 functions were identified by Ghidra, with **44 renamed** with descriptive names. Here are the key ones by category:

### Core
| Address | Function |
|---------|----------|
| `0x41946F` | Entry point (.itext) |
| `0x409960` | Core orchestrator (main init) |
| `0x4173B4` | CLI argument parser (8 flags) |
| `0x406F10` | Config decryptor (.pdata parser) |

### Cryptography
| Address | Function |
|---------|----------|
| `0x4192F4` | Feistel key expansion (6 rounds) |
| `0x419348` | Triple-pass RC4 KSA (3×768 iterations) |
| `0x41941C` | Modified RC4 PRGA (S[S[S[j]]]+1) |
| `0x4017C4` | RSA-1024 modular exponentiation |
| `0x401AAC` | 1024-bit square-and-multiply round |
| `0x401730` | XOR stream cipher (Salsa20 keystream) |
| `0x40E2AC` | File marker computation (3-round hash) |
| `0x4010D4` | Random number generator (RDRAND/RDSEED/RDTSC) |

### Obfuscation
| Address | Function |
|---------|----------|
| `0x405DB0` | Polymorphic trampoline builder |
| `0x405AFC` | PEB-walk API resolver |
| `0x405C34` | DLL hash resolver (filesystem search) |
| `0x401190` | ROR-13 hash (ASCII, API names) |
| `0x4011D4` | ROR-13 hash (Unicode, DLL names) |
| `0x406DB0` | Decrypt-and-copy (called 37 times) |

### Encryption Engine
| Address | Function |
|---------|----------|
| `0x416F90` | Main encryption loop (multi-thread) |
| `0x407438` | Drive enumeration thread |
| `0x40E214` | RSA session key processing |
| `0x40E308` | File open for encryption |
| `0x40E3B8` | Already-encrypted check (read footer) |

### Privilege Escalation
| Address | Function |
|---------|----------|
| `0x40B5D0` | Token elevation check |
| `0x40B664` | Privilege enabler (RtlAdjustPrivilege) |
| `0x40BA18` | COM-based UAC bypass |

### Anti-Forensics
| Address | Function |
|---------|----------|
| `0x410410` | Self-deletion + event log wipe |
| `0x416B18` | Scheduled task / self-delete via COM |
| `0x413868` | GPO network spread handler |

---

## Conclusion

LockBit 3.0 is, architecturally, one of the most well-engineered ransomware families ever deployed. In just 146 kilobytes, it packs:

- A **complete cryptographic engine** with a custom modified RC4 variant, Salsa20 file encryption, and RSA-1024 key wrapping
- **Polymorphic anti-disassembly** via 5 trampoline encoding modes with hardware-seeded randomization
- **Zero plaintext strings** — everything encrypted with `0x4803BFC7` or the modified RC4 cipher
- **Hash-based dynamic API resolution** with PEB walking and filesystem-based DLL discovery
- **Multi-threaded encryption** with 6 parallel worker threads
- **Self-deletion** via COM-based task scheduling
- **GPO-based lateral movement** for domain-wide propagation
- A **27-function decoy import table** that disguises the binary as a GUI application

The leaked builder toolkit makes this even more interesting from a research perspective — we can trace every design decision from the operator's `config.json` through the builder's PE template patching to the final encrypted binary's runtime behavior.

The technical sophistication here isn't just about encryption strength. It's about **operational security at every layer**: no strings to grep, no APIs to hook, no patterns to YARA, no static artifacts to flag. The developers understood that modern AV isn't looking for `CryptoEncrypt` calls — it's looking for behavioral patterns, and LockBit was engineered from the ground up to produce the fewest possible signals.

Understanding how this malware works — at the byte level — is how we build better defenses against it.
