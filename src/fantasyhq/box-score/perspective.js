const sharp = require('sharp');

// Recover the table plane from its yellow NAME column. This runs only when
// camera perspective changes that column's width; originals remain untouched.
function fit(points) {
  function regression(values) {
    const n=values.length,sy=values.reduce((s,p)=>s+p.y,0),sx=values.reduce((s,p)=>s+p.x,0);
    const slope=(n*values.reduce((s,p)=>s+p.y*p.x,0)-sy*sx)/(n*values.reduce((s,p)=>s+p.y*p.y,0)-sy*sy);
    return {slope,offset:(sx-slope*sy)/n};
  }
  if(points.length<8)return null;
  let line=regression(points);
  const errors=points.map(p=>Math.abs(p.x-line.offset-line.slope*p.y)).sort((a,b)=>a-b);
  const kept=points.filter(p=>Math.abs(p.x-line.offset-line.slope*p.y)<Math.max(8,errors[Math.floor(errors.length/2)]*3));
  if(kept.length<8)return null;
  return regression(kept);
}
function solve(matrix,values) {
  const rows=matrix.map((row,i)=>[...row,values[i]]),n=values.length;
  for(let i=0;i<n;i++){
    let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;
    [rows[i],rows[pivot]]=[rows[pivot],rows[i]];
    if(Math.abs(rows[i][i])<1e-9)return null;
    const divisor=rows[i][i];for(let k=i;k<=n;k++)rows[i][k]/=divisor;
    for(let j=0;j<n;j++)if(j!==i){const factor=rows[j][i];for(let k=i;k<=n;k++)rows[j][k]-=factor*rows[i][k];}
  }
  return rows.map(row=>row[n]);
}
async function rectifyTablePerspective(bytes,words) {
  const name=words.find(w=>/^NAME$/i.test(w.text)),min=words.find(w=>/^MIN$/i.test(w.text));
  const total=words.filter(w=>/^Total?$/i.test(w.text)&&name&&w.top>name.top).sort((a,b)=>b.top-a.top)[0];
  if(!name||!min||!total)return null;
  const {data,info}=await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info;
  const yellow=(x,y)=>{const i=(y*width+x)*channels;return data[i]>120&&data[i+1]>105&&data[i+2]<Math.min(data[i],data[i+1])*.65&&data[i]<data[i+1]*1.65;};
  const leftPoints=[],rightPoints=[],step=Math.max(2,Math.round(height/180)),gap=Math.max(5,Math.round(width*.009));
  for(let y=Math.round(name.y);y<total.y;y+=step){
    const runs=[];let start=null,last=null;
    for(let x=0;x<Math.min(width,min.left+width*.22);x++){
      if(yellow(x,y)){if(start===null)start=x;last=x;}
      else if(start!==null&&x-last>gap){runs.push([start,last]);start=null;}
    }
    // Do not accept a selected row whose yellow background spans the stats.
    const run=runs.filter(([a,b])=>b-a>width*.09&&b-a<width*.34&&b>name.left&&a<min.left).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
    if(run){leftPoints.push({x:run[0],y});rightPoints.push({x:run[1],y});}
  }
  const left=fit(leftPoints),right=fit(rightPoints);
  if(!left||!right)return null;
  const at=(line,y)=>line.offset+line.slope*y;
  const topWidth=at(right,name.y)-at(left,name.y),bottomWidth=at(right,total.y)-at(left,total.y);
  if(topWidth<=0||bottomWidth<=0||Math.abs(bottomWidth/topWidth-1)<.06)return null;
  // Locate top and bottom borders within the NAME panel, excluding its text.
  function edge(anchor,isTop){
    const points=[],a=at(left,anchor.y),b=at(right,anchor.y);
    for(let x=Math.ceil(a+(b-a)*.12);x<b-(b-a)*.12;x+=Math.max(2,Math.round((b-a)/35))){
      const from=Math.max(0,Math.round(anchor.top-(isTop?anchor.height*3:0))),to=Math.min(height-1,Math.round(anchor.top+anchor.height*(isTop?0:3)));
      let found=null;for(let y=from;y<=to;y++)if(yellow(x,y)){found=y;if(isTop)break;}
      if(found!==null)points.push({x:found,y:x});
    }
    const line=fit(points);return line&&{slope:line.slope,offset:line.offset};
  }
  const top=edge(name,true),bottom=edge(total,false);
  if(!top||!bottom)return null;
  function intersection(vertical,horizontal){const y=(horizontal.offset+horizontal.slope*vertical.offset)/(1-horizontal.slope*vertical.slope);return {x:at(vertical,y),y};}
  const corners=[intersection(left,top),intersection(right,top),intersection(right,bottom),intersection(left,bottom)];
  if(corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=width||p.y>=height))return null;
  // Map a rectangle in the existing image canvas back onto the source plane.
  const x0=corners[0].x,y0=corners[0].y,w=topWidth,h=corners[3].y-y0;
  if(h<height*.2)return null;
  const target=[{x:x0,y:y0},{x:x0+w,y:y0},{x:x0+w,y:y0+h},{x:x0,y:y0+h}];
  const matrix=[],values=[];
  target.forEach(({x,y},i)=>{const p=corners[i];matrix.push([x,y,1,0,0,0,-p.x*x,-p.x*y],[0,0,0,x,y,1,-p.y*x,-p.y*y]);values.push(p.x,p.y);});
  const m=solve(matrix,values);if(!m)return null;
  const output=Buffer.alloc(width*height*3,32);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const divisor=m[6]*x+m[7]*y+1,sx=(m[0]*x+m[1]*y+m[2])/divisor,sy=(m[3]*x+m[4]*y+m[5])/divisor;
    const ix=Math.floor(sx),iy=Math.floor(sy);if(ix<0||iy<0||ix>=width-1||iy>=height-1)continue;
    const dx=sx-ix,dy=sy-iy,out=(y*width+x)*3;
    for(let c=0;c<3;c++){const i=(iy*width+ix)*channels+c;output[out+c]=Math.round(data[i]*(1-dx)*(1-dy)+data[i+channels]*dx*(1-dy)+data[i+width*channels]*(1-dx)*dy+data[i+(width+1)*channels]*dx*dy);}
  }
  return sharp(output,{raw:{width,height,channels:3}}).png().toBuffer();
}
module.exports={rectifyTablePerspective};
