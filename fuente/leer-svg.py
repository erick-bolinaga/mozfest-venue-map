"""A minimal reader for the map SVG: enough to pull polygons out by layer id.
The full pipeline was lost when the container reset; this covers what is needed
to add newly traced layers to the model."""
import math, re, xml.etree.ElementTree as ET
NS='{http://www.w3.org/2000/svg}'
PX_PER_M = 5.8136

def _num(s): return [float(x) for x in re.findall(r'-?\d*\.?\d+(?:e-?\d+)?', s)]

def path_pts(d):
    pts=[]; cur=(0,0); start=None; i=0
    toks=re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?', d)
    def take(n):
        nonlocal i
        v=[float(x) for x in toks[i:i+n]]; i+=n; return v
    cmd=None
    while i < len(toks):
        t=toks[i]
        if re.match(r'[A-Za-z]', t): cmd=t; i+=1
        if cmd in 'Mm':
            x,y=take(2)
            cur=(x,y) if cmd=='M' else (cur[0]+x,cur[1]+y)
            pts.append(cur); start=cur; cmd='L' if cmd=='M' else 'l'
        elif cmd in 'Ll':
            x,y=take(2)
            cur=(x,y) if cmd=='L' else (cur[0]+x,cur[1]+y); pts.append(cur)
        elif cmd in 'Hh':
            x,=take(1); cur=(x,cur[1]) if cmd=='H' else (cur[0]+x,cur[1]); pts.append(cur)
        elif cmd in 'Vv':
            y,=take(1); cur=(cur[0],y) if cmd=='V' else (cur[0],cur[1]+y); pts.append(cur)
        elif cmd in 'Cc':
            v=take(6)
            p1,p2,p3=(v[0],v[1]),(v[2],v[3]),(v[4],v[5])
            if cmd=='c':
                p1=(cur[0]+p1[0],cur[1]+p1[1]); p2=(cur[0]+p2[0],cur[1]+p2[1]); p3=(cur[0]+p3[0],cur[1]+p3[1])
            for k in range(1,9):
                s=k/8; m=1-s
                pts.append((m**3*cur[0]+3*m*m*s*p1[0]+3*m*s*s*p2[0]+s**3*p3[0],
                            m**3*cur[1]+3*m*m*s*p1[1]+3*m*s*s*p2[1]+s**3*p3[1]))
            cur=p3
        elif cmd in 'Zz':
            if start: cur=start
            i+=0
        else:
            i+=1
    return pts

def _mul(p, q):
    """Compose two 2x3 matrices, p then q, in SVG's own order."""
    a1,b1,c1,d1,e1,f1 = p; a2,b2,c2,d2,e2,f2 = q
    return (a1*a2 + c1*b2, b1*a2 + d1*b2,
            a1*c2 + c1*d2, b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1, b1*e2 + d1*f2 + f1)

def _tr(m):
    """Every transform in the attribute, composed left to right.

    rotate() used to fall through to the identity here, and this map is drawn
    with 49 of them and not one matrix: every rotated thing came out square to
    the axes on a site that is traced twelve degrees off them. Nothing said so —
    the shapes were the right size in the right place, just all facing north."""
    if not m: return (1,0,0,1,0,0)
    out = (1,0,0,1,0,0)
    for name, args in re.findall(r'([a-zA-Z]+)\s*\(([^)]*)\)', m):
        v = _num(args)
        n = name.lower()
        if n == 'matrix' and len(v) >= 6:
            t = tuple(v[:6])
        elif n == 'translate' and v:
            t = (1,0,0,1, v[0], v[1] if len(v) > 1 else 0)
        elif n == 'scale' and v:
            t = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif n == 'rotate' and v:
            r = math.radians(v[0]); c, s_ = math.cos(r), math.sin(r)
            t = (c, s_, -s_, c, 0, 0)
            # rotate(a cx cy) turns about a point, which is that point brought
            # to the origin, turned, and put back.
            if len(v) >= 3:
                t = _mul(_mul((1,0,0,1, v[1], v[2]), t), (1,0,0,1, -v[1], -v[2]))
        elif n == 'skewx' and v:
            t = (1, 0, math.tan(math.radians(v[0])), 1, 0, 0)
        elif n == 'skewy' and v:
            t = (1, math.tan(math.radians(v[0])), 0, 1, 0, 0)
        else:
            continue
        out = _mul(out, t)
    return out

def _apply(p, t):
    a,b,c,d,e,f=t
    return (a*p[0]+c*p[1]+e, b*p[0]+d*p[1]+f)

def _utf8(s):
    """Undo double-encoded UTF-8 in a layer name.

    Figma sometimes exports a curly apostrophe as the numeric entities of its
    UTF-8 bytes -- `d&#226;&#128;&#153;actes` -- which XML-decode to three
    Latin-1 characters instead of one quote, and the label reaches the viewer
    as mojibake. Repaired here so every reader gets it right, and only when
    the round trip is exact: a real accented name does not survive the
    latin-1 encode and is left alone.
    """
    if not s or not any("\u00c2" <= c <= "\u00c3" or c == "\u00e2" for c in s):
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def shapes(root):
    out=[]
    def walk(e, tr, inherited):
        t=_tr(e.get('transform'))
        a,b,c,d,ee,f=tr; a2,b2,c2,d2,e2,f2=t
        cur=(a*a2+c*b2, b*a2+d*b2, a*c2+c*d2, b*c2+d*d2, a*e2+c*f2+ee, b*e2+d*f2+f)
        eid=_utf8(e.get('id')) or inherited
        tag=e.tag.replace(NS,'')
        if tag=='path' and e.get('d'):
            pts=[_apply(p,cur) for p in path_pts(e.get('d'))]
            if len(pts)>=3: out.append({'id':eid,'px':pts})
        elif tag=='rect':
            x,y=float(e.get('x',0)),float(e.get('y',0))
            w,h=float(e.get('width',0)),float(e.get('height',0))
            pts=[_apply(p,cur) for p in ((x,y),(x+w,y),(x+w,y+h),(x,y+h))]
            out.append({'id':eid,'px':pts})
        elif tag=='circle':
            # A dot on the plan: five of the entrances are drawn this way. It
            # comes out as a small polygon so every reader can treat it like
            # the rest, and 'circle' says it was a point and not a footprint.
            cx,cy,r=float(e.get('cx',0)),float(e.get('cy',0)),float(e.get('r',0))
            pts=[_apply((cx+r*math.cos(k*math.pi/4), cy+r*math.sin(k*math.pi/4)),cur) for k in range(8)]
            out.append({'id':eid,'px':pts,'circle':True})
        for ch in e: walk(ch, cur, eid)
    walk(root,(1,0,0,1,0,0),None)
    return out

def area(P):
    return abs(sum(P[i][0]*P[(i+1)%len(P)][1]-P[(i+1)%len(P)][0]*P[i][1]
                   for i in range(len(P)))/2)
