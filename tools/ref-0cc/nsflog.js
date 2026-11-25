// nsflog.js arquivo.nsf saida.txt segundos [faixa] -> linhas "tempo chip reg valor"
const fs=require('fs');const RGRIP=require('/home/claude/work/src/out/rgrip-dev.js');
(async()=>{const M=await RGRIP();const [f,out,secs,track]=process.argv.slice(2);
const d=fs.readFileSync(f),p=M._malloc(d.length);M.HEAPU8.set(d,p);M._rip_open(p,d.length);M._free(p);
const n=M._rip_run(+track||0,+secs||40);const L=new Float64Array(M.HEAPF64.buffer,M._rip_log(),n*4);
let s=[];for(let i=0;i<n;i++)s.push(L[i*4].toFixed(6)+' '+L[i*4+1]+' '+L[i*4+2].toString(16)+' '+L[i*4+3]);
fs.writeFileSync(out,s.join('\n')+'\n');})();
