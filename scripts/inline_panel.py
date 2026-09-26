#!/usr/bin/env python3
# 把 panel/app.js 内联进 management.html，产出自足单文件
import sys
html_path, js_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(html_path, encoding='utf-8').read()
js = open(js_path, encoding='utf-8').read()
out = html.replace('<script src="app.js"></script>', '<script>\n' + js + '\n</script>')
open(out_path, 'w', encoding='utf-8').write(out)
print('panel inlined:', len(out.encode('utf-8')), 'bytes ->', out_path)
