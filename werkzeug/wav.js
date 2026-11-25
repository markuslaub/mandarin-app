const fs=require('fs');
module.exports=function(p){const b=fs.readFileSync(p);let o=12,fmt,data;while(o<b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={af:b.readUInt16LE(o+8),ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};if(id==='data'){data=b.subarray(o+8,o+8+sz);break}o+=8+sz+(sz&1)}
const n=data.length/(fmt.bits/8)/fmt.ch,x=new Float32Array(n);for(let i=0;i<n;i++){const q=i*fmt.ch*(fmt.bits/8);x[i]=fmt.af===3?data.readFloatLE(q):fmt.bits===16?data.readInt16LE(q)/32768:data.readInt32LE(q)/2147483648}return{x,sr:fmt.sr}}
