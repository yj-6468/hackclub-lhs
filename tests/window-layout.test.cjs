const { test } = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../window-layout.js');
const area = {x:12,y:12,width:1000,height:650};
const inside = (r,a) => {
  for(const v of Object.values(r)) assert.ok(Number.isFinite(v));
  assert.ok(r.x >= a.x && r.y >= a.y && r.width > 0 && r.height > 0);
  assert.ok(r.x+r.width <= a.x+a.width+1e-9 && r.y+r.height <= a.y+a.height+1e-9);
};
test('offscreen, oversize, and corrupt saved geometry stays inside the work area',()=>{
  for(const width of [1,280,500,3000,NaN]) for(const height of [1,160,400,2000,Infinity]) {
    inside(layout.fit({x:-900,y:1200,width,height},area),area);
    inside(layout.fit({x:NaN,y:-40,width,height},{x:12,y:12,width:180,height:100}),{x:12,y:12,width:180,height:100});
  }
});
test('resizing never crosses the fixed opposite edge or the dock boundary',()=>{
  const r={x:200,y:100,width:400,height:300};
  for(const edge of ['n','e','s','w','ne','nw','se','sw']) for(const delta of [-5000,-10,10,5000]) {
    const next=layout.resize(r,delta,delta,edge,area);inside(next,area);
    if(edge.includes('w')) assert.equal(next.x+next.width,r.x+r.width);
    if(edge.includes('n')) assert.equal(next.y+next.height,r.y+r.height);
    if(edge.includes('e')) assert.equal(next.x,r.x);
    if(edge.includes('s')) assert.equal(next.y,r.y);
    assert.ok(next.width>=280 && next.height>=160);
  }
});
test('tiling fills both halves with a 12px gap, maximize respects dock work area',()=>{
  const left=layout.snap('left',area),right=layout.snap('right',area);
  inside(left,area);inside(right,area);
  assert.equal(right.x-left.x-left.width,12);
  assert.equal(left.width+right.width+12,area.width);
  assert.deepEqual(layout.snap('maximized',area),area);
});
