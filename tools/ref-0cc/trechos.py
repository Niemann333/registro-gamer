import sys,ast,subprocess,os,re
try: os.environ['RATE']=re.search(r'taxa ([0-9.]+)',open(sys.argv[1]+'.rate.txt').read()).group(1)
except Exception: pass
b=sys.argv[1]
out=subprocess.run(['python3','/home/claude/work/apucmp.py',b+'.ref.log',b+'.fur.log','7200','7200'],capture_output=True,text=True).stdout.split('\n')
rows=[l for l in out if l[:1].isdigit()]
cl=[]
for l in rows:
  i,rest=l.split(' ',1);a,c=rest.split(' | ');a=ast.literal_eval(a);c=ast.literal_eval(c)
  ks=[k for k in a if k!='DMC' and a[k]!=c[k]]
  if a['DMC'][:2]!=c['DMC'][:2] or a['DMC'][3]!=c['DMC'][3]: ks.append('DMC')
  if ks:
    i=int(i)
    if cl and i-cl[-1][1]<=2 and set(ks)&cl[-1][2]: cl[-1][1]=i; cl[-1][2]|=set(ks)
    else: cl.append([i,i,set(ks)])
print(len(cl),'trechos:',' '.join('%d-%d%s'%(a,b_,sorted(k)) for a,b_,k in cl[:25]))
