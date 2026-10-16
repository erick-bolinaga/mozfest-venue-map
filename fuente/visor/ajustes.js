/* ---------- text size ----------
   Steps rather than free zoom, so every stop is one we have checked actually
   fits: at the top of the range the dock is close to the width of a small
   phone, and a value between two stops could put it over. */
const SCALES = [.875, 1, 1.125, 1.25];
let uiStep = 1;
/* getItem returns null when nothing is stored, and +null is 0 — a perfectly
   valid index into SCALES, which would silently open every first visit at the
   smallest size. The null has to be rejected before the coercion. */
try{
  const s = localStorage.getItem('mozfest-ui-scale');
  if(s !== null && SCALES[+s] !== undefined) uiStep = +s;
}catch(_){}
function applyScale(){
  document.documentElement.style.setProperty('--ui-scale', SCALES[uiStep]);
  $('#uiVal').textContent = Math.round(SCALES[uiStep] * 100) + '%';
  $('#uiDown').disabled = uiStep === 0;
  $('#uiUp').disabled   = uiStep === SCALES.length - 1;
  try{ localStorage.setItem('mozfest-ui-scale', uiStep); }catch(_){}
}
$('#uiDown').onclick = ()=>{ if(uiStep > 0){ uiStep--; applyScale(); } };
$('#uiUp').onclick   = ()=>{ if(uiStep < SCALES.length - 1){ uiStep++; applyScale(); } };
applyScale();

/* --- readout: behind ?dev=1, and a copy that survives file:// --- */
const roBox = $('#readout'), roBtn = $('#roBtn');
/* Only the click writes. Saving on every load turned the default into something
   that read back as a deliberate choice, which is why the key is bumped: the
   values the old version left behind are not preferences and are ignored. */
function showReadout(on, remember){
  /* One gate, so that no later caller can put the instrument back on a
     visitor's map by reaching past the menu row that is no longer there. */
  on = on && WORKBENCH;
  roBox.hidden = !on;
  roBtn.setAttribute('aria-pressed', on);
  if(remember){ try{ localStorage.setItem('mozfest-readout-2', on ? '1' : '0'); }catch(_){} }
  updateReadout();
}
/* It used to be a row anyone could find, so it started off and waited to be
   asked for. Now that ?dev=1 is the only door to it, typing the flag IS the
   asking — it is how a view gets composed — so it comes up already reporting.
   A stored choice still wins: turning it off inside dev mode is a real one. */
let roOn = WORKBENCH;
try{ const v = localStorage.getItem('mozfest-readout-2'); if(v !== null) roOn = v === '1'; }catch(_){}
roBtn.onclick = ()=> showReadout(roBox.hidden, true);
showReadout(roOn, false);
/* The row is removed and not hidden: .pop .row is display:flex, which outranks
   the [hidden] attribute's rule, so a hidden row would sit there in plain
   sight. The box itself stays in the document — the test bench opens it without
   the flag, and an element that is only hidden still answers questions. */
if(!WORKBENCH) roBtn.remove();

$('#roCopy').onclick = async ()=>{
  const btn = $('#roCopy');
  let ok = false;
  try{ await navigator.clipboard.writeText($('#roCode').textContent); ok = true; }catch(_){}
  if(!ok){
    /* A page opened from disk is usually refused the clipboard, so select the
       line instead and let the keyboard finish the job. */
    const r = document.createRange(); r.selectNodeContents($('#roCode'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  btn.textContent = ok ? 'Copied' : 'Selected \u2014 press Ctrl+C';
  setTimeout(()=>{ btn.textContent = 'Copy'; }, 1700);
};

