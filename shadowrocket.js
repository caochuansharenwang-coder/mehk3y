var savedTheme=localStorage.getItem('theme');
if(savedTheme){document.documentElement.dataset.theme=savedTheme;}
else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.dataset.theme='dark';}
var themeToggle=document.getElementById('themeToggle');
themeToggle.addEventListener('click',function(){
  var next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  localStorage.setItem('theme',next);
});
var q=document.getElementById('q'),empty=document.getElementById('empty'),toast=document.getElementById('toast');
var sw=document.getElementById('sw'),clr=document.getElementById('clr'),cntinfo=document.getElementById('cntinfo');
var cards=[].slice.call(document.querySelectorAll('.card'));
var secs=[].slice.call(document.querySelectorAll('.sec'));
function srcOf(c){
  if(c.querySelector('.s-first'))return'first';
  if(c.querySelector('.s-iab'))return'iab';
  if(c.querySelector('.s-theme'))return'theme';
  if(c.querySelector('.s-yf'))return'yf';
  return c.closest('#yf')?'yf':'first';
}
cards.forEach(function(c){c.dataset.src=srcOf(c);});
(function(){var cnt={all:cards.length};cards.forEach(function(c){cnt[c.dataset.src]=(cnt[c.dataset.src]||0)+1;});
document.querySelectorAll('[data-sf]').forEach(function(ch){var s=ch.querySelector('.cnt');if(s)s.textContent=cnt[ch.dataset.sf]||0;});})();
var activeSrc='all';
function norm(s){return (s||'').toLowerCase().trim();}
var raf;
function filter(){cancelAnimationFrame(raf);raf=requestAnimationFrame(doFilter);}
function doFilter(){
  var v=norm(q.value),any=0;
  sw.classList.toggle('has',!!q.value);
  for(var i=0;i<cards.length;i++){
    var c=cards[i];
    var m=(activeSrc==='all'||c.dataset.src===activeSrc)&&(!v||c.dataset.k.indexOf(v)>=0);
    c.classList.toggle('hide',!m);
    if(m)any++;
  }
  for(var j=0;j<secs.length;j++){
    var s=secs[j];
    if(s.id==='adv'){s.classList.toggle('hide',activeSrc!=='all'||!!v);continue;}
    s.classList.toggle('hide',!s.querySelector('.card:not(.hide)'));
  }
  empty.style.display=any?'none':'block';
  cntinfo.textContent=(v||activeSrc!=='all')?any+' 项匹配':'';
}
q.addEventListener('input',filter);
clr.addEventListener('click',function(){q.value='';q.focus();filter();});
var sfchips=[].slice.call(document.querySelectorAll('[data-sf]'));
sfchips.forEach(function(ch){ch.addEventListener('click',function(){
  sfchips.forEach(function(x){x.classList.remove('on')});ch.classList.add('on');
  activeSrc=ch.dataset.sf;filter();
});});
document.addEventListener('keydown',function(e){
  if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();q.select();}
  else if(e.key==='Escape'&&document.activeElement===q){q.value='';filter();q.blur();}
});
var totop=document.getElementById('totop'),navlinks=[].slice.call(document.querySelectorAll('nav a'));
window.addEventListener('scroll',function(){totop.classList.toggle('show',window.scrollY>500);},{passive:true});
totop.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
if('IntersectionObserver'in window){
  var io=new IntersectionObserver(function(es){es.forEach(function(en){
    if(en.isIntersecting){var id=en.target.id;navlinks.forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+id);});}
  });},{rootMargin:'-12% 0px -78% 0px'});
  secs.forEach(function(s){io.observe(s);});
}
var tchips=[].slice.call(document.querySelectorAll('[data-tf]'));
tchips.forEach(function(ch){ch.addEventListener('click',function(){
  tchips.forEach(function(x){x.classList.remove('on')});ch.classList.add('on');
  var tf=ch.dataset.tf;
  document.querySelectorAll('.card.theme').forEach(function(c){
    var show=tf==='all'||c.classList.contains(tf);c.style.display=show?'':'none';});
});});
document.addEventListener('click',function(e){
  var b=e.target.closest('.copy');if(!b)return;e.preventDefault();
  var t=b.dataset.copy;
  function ok(){toast.classList.add('show');setTimeout(function(){toast.classList.remove('show')},1100);}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,function(){fb(t,ok)});}
  else fb(t,ok);
});
function fb(t,ok){var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity=0;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');ok();}catch(e){}document.body.removeChild(ta);}
