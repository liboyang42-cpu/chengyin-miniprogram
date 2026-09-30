import re,os,sys,tempfile

# cy-page-title 双重缩进门禁:容器已有横向 padding 时,标题必须传 flush,否则被推成双倍缩进。
#
# ⚠️ 注释必须先剥掉再扫(2026-08-01):原实现用朴素子串找 'cy-page-title',
#    wxml 注释里只要提到这个组件名(如「顶部用 cy-page-title 渲染大标题」),就会被
#    当成真标签,再去截 tag、发现里面没有 flush ⇒ 报一个根本不存在的双重缩进。
#    批4 踩过,当时是改注释措辞绕开的,脚本本体没动 —— 绕开写法只要有人写回自然措辞就复发。
#    正解与死链门禁 wxml-handler-lint.js 的 maskWxmlComments 一致:把注释内容抹成等长空格、
#    保留换行 ⇒ 下游所有 index/rfind 偏移与行号都不漂,只是注释内容"看不见"了。
#    同时这也修好了另一半:被注释掉的 <view class="..."> 原先会被算进祖先栈,凭空造出
#    一个带 padding 的祖先。
CMT=re.compile(r'<!--.*?-->',re.S)
def mask_comments(t):
    return CMT.sub(lambda m:re.sub(r'[^\n]',' ',m.group(0)),t)

padre=re.compile(r'\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}',re.S)
hre=re.compile(r'(padding(?:-left|-inline|-inline-start)?)\s*:\s*([^;]+)')
def collect(paths):
    pad={}
    for p in paths:
        if not os.path.exists(p): continue
        t=open(p,encoding='utf-8').read()
        for m in padre.finditer(t):
            cls,body=m.group(1),m.group(2)
            for hm in hre.finditer(body):
                prop,v=hm.group(1),hm.group(2).strip()
                parts=v.split()
                if prop=='padding':
                    horiz = parts[1] if len(parts)>=2 else parts[0]
                else: horiz=parts[0]
                if horiz not in ('0','0rpx','0px'):
                    pad.setdefault(cls,set()).add(f"{prop}:{horiz}")
    return pad
GLOBAL=['app.wxss','style/common.wxss','common.wxss']

def scan(root='.'):
    hits=[]
    for dp,_,fs in os.walk(root):
        if 'node_modules' in dp or '.git' in dp: continue
        for f in fs:
            if not f.endswith('.wxml'): continue
            p=os.path.join(dp,f)
            # 全程用抹过注释的文本做结构判断(找标签、截 tag、数祖先 view)
            t=mask_comments(open(p,encoding='utf-8').read())
            if 'cy-page-title' not in t: continue
            i=t.index('cy-page-title')
            tag=t[t.rfind('<',0,i):t.index('>',i)+1]
            if 'flush' in tag: continue
            own=os.path.join(dp,f[:-5]+'.wxss')
            pad=collect([own]+[os.path.join(root,g) for g in GLOBAL])   # ★ 只认本页 wxss + 全局
            head=t[:i]; stack=[]
            for m in re.finditer(r'<(/?)view\b([^>]*)>',head):
                if m.group(1):
                    if stack: stack.pop()
                elif not m.group(2).rstrip().endswith('/'):
                    c=re.search(r'class="([^"]*)"',m.group(2))
                    stack.append(c.group(1) if c else '')
            anc=[(c,pad[c]) for s in stack for c in s.split() if c in pad]
            if anc: hits.append((p,anc))
    return hits

# ---------- 自证:证明它「能判红,也能判绿」 ----------
# 只有能变红的门禁才有价值;只会绿的门禁比没有门禁更危险(会让人以为已经被看过了)。
def selftest():
    cases=[
        # (用例名, 期望命中数, wxml, wxss)
        ('真双重缩进(容器有 padding + 没传 flush)⇒ 必须红',1,
         '<view class="wrap">\n  <cy-page-title title="x" />\n</view>\n',
         '.wrap { padding: 0 32rpx; }\n'),
        ('传了 flush ⇒ 绿',0,
         '<view class="wrap">\n  <cy-page-title title="x" flush="{{true}}" />\n</view>\n',
         '.wrap { padding: 0 32rpx; }\n'),
        ('容器没有横向 padding ⇒ 绿(不该红的别红)',0,
         '<view class="wrap">\n  <cy-page-title title="x" />\n</view>\n',
         '.wrap { padding: 0; }\n'),
        # ↓ 本次修复针对的误报
        ('注释里提到组件名、真标签已传 flush ⇒ 绿(注释不算数)',0,
         '<view class="wrap">\n  <!-- 顶部用 cy-page-title 渲染大标题 -->\n'
         '  <cy-page-title title="x" flush="{{true}}" />\n</view>\n',
         '.wrap { padding: 0 32rpx; }\n'),
        ('整个标签被注释掉、真标签已传 flush ⇒ 绿',0,
         '<view class="wrap">\n  <!-- <cy-page-title title="旧" /> -->\n'
         '  <cy-page-title title="x" flush="{{true}}" />\n</view>\n',
         '.wrap { padding: 0 32rpx; }\n'),
        ('被注释掉的祖先 view 不算祖先 ⇒ 绿',0,
         '<!-- <view class="wrap"> -->\n<cy-page-title title="x" />\n',
         '.wrap { padding: 0 32rpx; }\n'),
        ('注释挡在前面,后面真的漏传 flush ⇒ 仍要红(别把误报修成漏报)',1,
         '<view class="wrap">\n  <!-- 这里本来该用 cy-page-title -->\n'
         '  <cy-page-title title="x" />\n</view>\n',
         '.wrap { padding: 0 32rpx; }\n'),
    ]
    fail=0
    with tempfile.TemporaryDirectory() as d:
        for name,want,wxml,wxss in cases:
            sub=os.path.join(d,'p'); os.makedirs(sub,exist_ok=True)
            open(os.path.join(sub,'a.wxml'),'w',encoding='utf-8').write(wxml)
            open(os.path.join(sub,'a.wxss'),'w',encoding='utf-8').write(wxss)
            got=len(scan(d))
            if got!=want:
                print(f"[selftest] ✗ {name}:期望 {want} 命中,实得 {got}"); fail=1
            else:
                print(f"[selftest] ✓ {name}")
    if fail==0: print('[selftest] ✓ cy-page-title 双重缩进门禁自证通过(能判红也能判绿、注释不算数)')
    return fail

if __name__=='__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    hits=scan('.')
    for p,a in sorted(hits):
        print(f"{p}\n    {'; '.join(c+' → '+','.join(v) for c,v in a)}")
    print(f"\n共 {len(hits)} 页(已排除跨页同名类污染)")
