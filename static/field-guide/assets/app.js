(function(){
 var root=document.documentElement, tb=document.getElementById('themeBtn');
 if(tb)tb.onclick=function(){var cur=root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var nx=cur==='dark'?'light':'dark';root.setAttribute('data-theme',nx);try{localStorage.setItem('fg-theme',nx)}catch(e){}};
 var ex=document.getElementById('ethics');try{if(localStorage.getItem('fg-ethics')&&ex)ex.classList.add('hide')}catch(e){}
 var exX=document.getElementById('ethicsX');if(exX)exX.onclick=function(){ex.classList.add('hide');try{localStorage.setItem('fg-ethics','1')}catch(e){}};
 var side=document.getElementById('side'),hb=document.getElementById('hamb');
 if(hb)hb.onclick=function(){side.classList.toggle('open')};
 document.addEventListener('click',function(e){if(window.innerWidth<=1080&&side&&side.classList.contains('open')&&!side.contains(e.target)&&e.target!==hb)side.classList.remove('open')});
 document.querySelectorAll('.pre').forEach(function(p){var txt=p.textContent;var b=document.createElement('button');b.className='copy';b.textContent='Copy';b.onclick=function(){navigator.clipboard.writeText(txt).then(function(){b.textContent='Copied!';b.classList.add('done');setTimeout(function(){b.textContent='Copy';b.classList.remove('done')},1400)})};p.appendChild(b);});
 // reveal a hidden specimen when linked by anchor
 function revealHash(){var h=location.hash;if(h&&h.indexOf('#report-')===0){var el=document.getElementById(h.slice(1));if(el){el.classList.remove('hidden');el.scrollIntoView();}}}
 window.addEventListener('hashchange',revealHash);revealHash();
 // load more
 var lm=document.getElementById('loadmore');if(lm)lm.onclick=function(){document.querySelectorAll('.spec.hidden').forEach(function(s){s.classList.remove('hidden')});lm.remove();upd();};
 var cont=document.getElementById('specimens');
 function upd(){var sh=document.getElementById('showing');if(sh&&cont)sh.textContent='showing '+cont.querySelectorAll('.spec:not(.hidden)').length;}
 var sortSel=document.getElementById('sort');if(sortSel)sortSel.onchange=function(){var k=this.value;var a=[].slice.call(cont.children);a.sort(function(x,y){if(k==='score')return 0;return (+y.dataset[k==='sev'?'sev':k])-(+x.dataset[k==='sev'?'sev':k])});a.forEach(function(el){cont.appendChild(el)});};
 upd();
 // search (fetch global index)
 var q=document.getElementById('q'),rz=document.getElementById('results'),IDX=null,R=window.SITE_ROOT||'';
 function load(cb){if(IDX)return cb();fetch(R+'assets/search-index.json').then(function(r){return r.json()}).then(function(d){IDX=d;cb()}).catch(function(){IDX=[]})}
 function run(){var v=q.value.trim().toLowerCase();if(!v){rz.classList.remove('show');return;}
   load(function(){
     var specs=[],pages=[];
     for(var i=0;i<IDX.length&&specs.length<12;i++){var x=IDX[i];if(x.page)continue;if((x.t||'').toLowerCase().indexOf(v)>=0||(x.p||'').toLowerCase().indexOf(v)>=0||String(x.id).indexOf(v)>=0)specs.push(x);}
     for(var j=0;j<IDX.length&&pages.length<6;j++){var y=IDX[j];if(y.page&&(y.t||'').toLowerCase().indexOf(v)>=0)pages.push(y);}
     var h='';
     if(pages.length)h+='<div class="cat">Classes</div>'+pages.map(function(y){return '<a href="'+R+y.pg+'">'+y.t.replace(/</g,'&lt;')+'</a>'}).join('');
     if(specs.length)h+='<div class="cat">Specimens</div>'+specs.map(function(x){return '<a href="'+R+x.pg+'#report-'+x.id+'">'+x.t.replace(/</g,'&lt;')+'<span class="rid">'+x.cl+' · #'+x.id+'</span></a>'}).join('');
     if(!h)h='<div class="none">No matches for “'+v.replace(/</g,'')+'”.</div>';
     rz.innerHTML=h;rz.classList.add('show');
   });}
 if(q){q.addEventListener('input',run);q.addEventListener('focus',run);
   document.addEventListener('click',function(e){if(!e.target.closest('.searchwrap'))rz.classList.remove('show')});
   document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});}
})();