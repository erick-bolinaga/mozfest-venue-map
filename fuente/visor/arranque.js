/* ---------- opening move ----------
   One pass per page load: the site swings in from due north and settles on
   HOME_VIEW. Reset returns to that view rather than replaying this, so the
   flight stays a first impression instead of something you sit through every
   time you lose your place. Any touch or scroll cancels it. */
const NORTH_YAW = 0;   /* model -Z up the screen. The trace carries a -12 degree
                          georeferencing rotation that is still uncalibrated, so
                          this is the model's north and not the surveyed one. */
const INTRO_MS = 2400;
function runIntro(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ home(); return; }
  yaw = NORTH_YAW; pitch = 1.30; dist = Math.min(DIST_MAX, fitDist(SPAN)*1.55);
  target.set(HOME_VIEW.tx, 0, HOME_VIEW.tz);
  lightMix = 0; applyLighting(); applyCam();
  flyTo({yaw:HOME_VIEW.yaw, pitch:HOME_VIEW.pitch, dist:homeDist(),
         tx:HOME_VIEW.tx, ty:0, tz:HOME_VIEW.tz, light:0}, INTRO_MS);
}

/* Mouse wording on a phone is worse than no wording. */
$('.hud').textContent = matchMedia('(pointer:coarse)').matches
  ? 'Drag to pan, two fingers to turn, pinch to zoom, tap a building'
  : 'Drag to pan, right-drag to turn, scroll to zoom, click a building';

addEventListener('resize', ()=>{
  const wasFramed = Math.abs(dist - homeDist()) < 1;
  persp.aspect = innerWidth/innerHeight; persp.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  /* Turning a phone sideways should reframe the site, but only for someone who
     has not moved the camera yet — otherwise a rotation throws away their view. */
  if(wasFramed){ dist = fitDist(SPAN); }
  applyCam();          /* y applyCam ya pide el redibujo */
});
