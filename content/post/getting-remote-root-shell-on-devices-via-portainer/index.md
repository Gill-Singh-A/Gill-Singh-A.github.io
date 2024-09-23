---
title: "Getting Remote Root Shell on Devices via Portainer"
description: In this blog, we explore how to gain remote root access on devices via Portainer, covering OSINT techniques, brute-force attacks, and exploiting misconfigurations, while offering mitigation strategies to enhance security.
date: 2024-09-23T05:21:38+05:30
image: assets/images/main_image.png
math: 
license: 
hidden: false
comments: true
draft: false
tags: ["cybersecurity", "infosec", "hacking", "docker", "shodan"]
categories: ["hacking", "cybersecurity", "docker"]
---
## Portainer
[Portainer](https://www.portainer.io/) is an open-source management tool designed for containers. It offers a user-friendly, lightweight web interface that simplifies the deployment and management of Docker environments. It's important to note that while Portainer itself does not run with root privileges, if the Docker service managed by Portainer operates with root permissions, it could potentially lead to a remote root shell vulnerability, as discussed further.
## Information Gathering
### Collecting Target Devices
We'll use [Shodan Search Engine](https://www.shodan.io) to Collect Target Devices.<br />
On [Shodan Search Engine](https://www.shodan.io) search with query *product:portainer*, this would list out all the Devices that were identified running Portainer by Shodan.<br />
![Shodan Search](/assets/images/shodan_search.png)
After setting the requeired filters, we can download the results.<br />
![Shodan Download Results](/assets/images/shodan_download_results.png)<br />
The Number of Results that can be downloaded depends upon your query credits available(1 Query Credit = 100 Results)<br />
![Shodan Download Results](/assets/images/shodan_download_results_1.png)<br />
After Shodan has done compiling the data, it sends us a Mail that *Data is ready for Download* or we can alernatively wait on [Shodan Download Page](https://www.shodan.io/download) while the data is being compiled<br />
![Shodan Download Mail](/assets/images/shodan_mail.png)<br />
The Download will be in the format *.json.gz*. Shodan provides a Command-Line Utility to Parse the data in these download files.<br />
The utility can be installed with the command
```bash
pip install shodan
```
The Targets from the downloaded file can be extracted with the following command
```bash
shodan parse --fields ip_str,port --separator : {file_name}.json.gz
```
To save the Targets to a file, simply redirect the output of the command
```bash
shodan parse --fields ip_str,port --separator : {file_name}.json.gz > {file_name_to_save_targets_to}
```
I sometimes manually filterout some IPs by running a port scan, because sometimes the information provided by Shodan for some Devices is outdated.
### Compiling a suitable Wordlist for Brute-Force
We can search for various Default/Weak Credentials Online. One of the best Repositories that I find for collecting Passwords for Brute-Force is [SecLists](https://github.com/danielmiessler/SecLists).<br />
Here, I won't disclose more information about the wordlists that I use.
## Brute Force
To access the Portainer Dashboard, we first have to find correct credentials.<br />
After collecting Target Devices and Passwords, we're ready to do a Brute-Force attack on the Portainer Web Interface.<br />
I use [Gill-Singh-A](https://github.com/Gill-Singh-A/Portainer-Brute-Force), it is a Program written in Python that uses requests to brute force the Web Interface of Portainer through */api/auth* endpoint and multithreading module to parallelize the brute force tasks.<br >
I've attached a small example of brute force in the following picture.<br />
![Brute Force](/assets/images/brute_force.png)
## Getting Remote Root Shell
Now after getting access to the Portainer Web Interface, our job is to get a Remote Root Shell.<br />
![Portainer Interface](/assets/images/portainer_interface.png)<br />
First, we have to go to Images and find any Linux OS Image. Here in this example we see *ubuntu:latest*<br />
![Portainer Images](/assets/images/portainer_images.png)<br />
Next, we go to containers and click on **Add Container**<br />
![Add Container](/assets/images/add_container.png)<br />
We name the Container as *health_test* :) and pull the Linux OS Image, in this case *ubuntu:latest*<br />
![Container Name and Image](/assets/images/container_name_and_image.png)<br />
In the command and Logging Section, we select *Interactive and TTY* Console.<br />
![Interactive and TTY Console](/assets/images/tty_shell.png)<br />
Next we go to *Volume*, Click on *Map Additional Volume*, Click on *Bind* and select */host* in container and */* in host. This way we've mounted the Host Root Directory into the Docker Container and we'll use this to get the Remote Root Shell in the upcoming setups<br />
![Volume Bind](/assets/images/volume_bind.png)<br />
Next in *Runtime & Resources* turn *Privilege Mode* on.<br />
![Privilege Mode](/assets/images/privilege_mode.png)<br />
Next in *Capabilities*, turn every Linux Capability on to ensure smooth operation.<br />
![Linux Capabilities](/assets/images/linux_capabilities.png)<br />
Then Click on *Deploy The Container*.<br />
![Deploy The Container](/assets/images/container_deploy.png)<br />
We can see our Container *health_test* running.<br />
![Container Running](/assets/images/container_running.png)<br />
Then we click on *exec console* and in the *Container Console* connect to */bin/bash* as *root* user.<br />
![Container Root User Bash](/assets/images/container_root_user_connect.png)<br />
Here, we've run the *bash* as *root* user in the Container<br />
![Container Bash Shell](/assets/images/container_bash_shell.png)<br />
We type the command *ps aux* and see *bash* Process with PID 1, this tells us that currently we're inside the Container.<br />
![Container Bash Shell PID](/assets/images/container_bash_shell_pid.png)<br />
Then to break out of the Container, we change our directory to */host* and *chroot* into it and to confirm that We've successfully broken out of the container, we type *ps aux* and see that *systemd* has PID 1. Which confirms that we've broken out of the Container into the Host Machine<br />
![Container Break](/assets/images/container_break.png)<br />
The *chroot* command usage is to change root directory to the supplied directory for the current running process and its children, so when we ran chroot in the */host* directory where the Host was mounted, then it changed the root directory to host and hence broke out of the docker container.<br />
Next we check that we can login as root via ssh using the following command
```bash
cat /etc/ssh/sshd_config | grep Root
```
If not then we set it to yes.<br />
![SSH Root Login](/assets/images/ssh_root_login.png)<br />
Next we generate a Public-Private Key Pair with the following command on our machine
```bash
ssh-keygen -t rsa -b 4096 -C root
```
Then paste the Public Key File to the */root/.ssh/authorized_keys* of the Target Machine.<br />
![SSH Keys](/assets/images/ssh_keys.png)<br />
After all this, now we'll be able to ssh to the Target Machine with root user.<br />
![SSH Root](/assets/images/ssh_root.png)<br />
We can further more Geolocate the IP Addresses using [Gill-Singh-A/IP-Location](https://github.com/Gill-Singh-A/IP-Location) to get an approximate location of the Devices (although it may not always be correct)<br />
![IP Geolocation](/assets/images/ip_geolocation.png)<br />
We can use the Compromised Devices for Cluster Computing after gaining basic information about their Processing Power, Memory, Space, etc<br />
![DB](/assets/images/collection.png)<br />
## Mitigations
In this blog we saw that how easy it was to gain remote root access to a Device that was using misconfigured Portainer Web Interface (exposed to internet, using weak credentials) in several ways.<br />
To avoid getting your Device compromised, you should take the following steps:
* Make sure that Portainer Interface is not exposed to the Internet
* Not using Default/Weak Credentials
* Setting up Proper Firewall Rules
* Keeping the Software/Firmware up to date, to avoid any CVEs present in the device that could be exploited
### Note
The Above mentioned points doesn't Guarantee 100% protection, they only enhance the security
## Checking Leaked Passwords
There are several websites you can use to check whether the password that you're using has been leaked somewhere online or not. Here are some popular ones:
* [Have I Been Pwned](https://haveibeenpwned.com/): Check if your email or phone is in a data breach
* [Dehashed](https://www.dehashed.com/): Free deep-web scans and protection against credential leaks
* [LeakCheck.io](https://leakcheck.io/): Make sure your credentials haven't been compromised
* [crackstation.net](https://crackstation.net/): Massive pre-computed lookup tables to crack password hashes
* [HashKiller](https://hashkiller.io/listmanager): Pre-cracked Hashes, easily searchable
* [LeakedPassword](https://leakedpassword.com/): Search across multiple data breaches to see if your pass has been compromised
* [BugMeNot](https://bugmenot.com/): Find and share logins
<!-- -->
Source: [edoardottt/awesome-hacker-search-engines](https://github.com/edoardottt/awesome-hacker-search-engines)