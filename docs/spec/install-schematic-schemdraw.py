#!/usr/bin/env python3
# Generator for install-schematic-schemdraw.svg / .png  (EcoStar final in-box wiring + RJ-45 pinout).
# This is the schemdraw (component-fidelity) take on the hand-drawn install-schematic.svg; both are
# kept until one is chosen as canonical. Every wire is routed manually through explicit waypoints
# (schemdraw's auto-router draws straight through far-apart blocks), and the optocouplers are
# horizontally mirrored (.reverse()) so the LED side faces the RJ-45 and the transistor side the i4.
#
# Run (needs schemdraw + matplotlib + pillow in a venv):
#   python3 -m venv ~/.venvs/sdraw && ~/.venvs/sdraw/bin/pip install schemdraw matplotlib pillow
#   MPLBACKEND=Agg ~/.venvs/sdraw/bin/python docs/spec/install-schematic-schemdraw.py
# NOTE: label text must stay ASCII and avoid < > & (schemdraw's text-size pass XML-parses each line).
import os
import schemdraw
from schemdraw import elements as elm
schemdraw.use('matplotlib')   # matplotlib backend renders unicode labels without XML-parsing them
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'install-schematic-schemdraw')

# ---- palette ----
ORG='#e8820e'; GRN='#2a9d3a'; BLU='#2563c7'; BRN='#7a4a1e'
REDL='#b30000'; NBLU='#1565c0'; V5='#cc7700'; GND='#666666'
RED='#cc0000'; BLK='#111111'; ISO='#228833'; GOLD='#b8860b'

d = schemdraw.Drawing(file=OUT+'.svg', font='DejaVu Sans',
                      fontsize=10, color='black', bgcolor='white')
d.config(unit=1)

# ---------- helpers ----------
def P(elem, name):
    p = getattr(elem, name)
    return (float(p[0]), float(p[1]))

def seg(pts, color, ls='-', lw=2.0):
    for i in range(len(pts)-1):
        d.add(elm.Line().at(pts[i]).to(pts[i+1]).color(color).linewidth(lw).linestyle(ls))

def hjog(a, b, vx, color, ls='-', lw=2.0):
    seg([a, (vx, a[1]), (vx, b[1]), b], color, ls, lw)

def dot(p, color='#333'):
    d.add(elm.Dot(radius=0.09).at(p).color(color))

def measure(pins, **kw):
    sd = schemdraw.Drawing()
    e = sd.add(elm.Ic(pins=pins, **kw).at((0, 0)))
    a = {an: (float(getattr(e, an)[0]), float(getattr(e, an)[1])) for an in e.anchors}
    bb = e.get_bbox()                       # local bbox (xmin,ymin,xmax,ymax)
    a['_bb'] = (float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3]))
    return a

def place_ic(pins, ref, target, label, fs=9, **kw):
    off = measure(pins, **kw)
    dx, dy = target[0]-off[ref][0], target[1]-off[ref][1]
    e = d.add(elm.Ic(pins=pins, **kw).at((dx, dy)).label(label, loc='center', fontsize=fs))
    bb = off['_bb']
    e._extent = (bb[0]+dx, bb[1]+dy, bb[2]+dx, bb[3]+dy)   # world bbox
    return e

def lbl(x, y, txt, color='black', fs=9, halign='center'):
    d.add(elm.Label().at((x, y)).label(txt, fontsize=fs, color=color, halign=halign))

# ===========================================================
#  RJ-45 connector  (internal taps = L pins, cable = R pins)
# ===========================================================
order = [('1','ORG'),('2','W/ORG'),('3','GRN'),('4','W/GRN'),
         ('5','BLU'),('6','W/BLU'),('7','BRN'),('8','W/BRN')]
rjpins=[]
for i,(num,col) in enumerate(order):
    slot='%d/8'%(8-i)
    rjpins.append(elm.IcPin(name=num+' '+col, side='right', slot=slot, anchorname='R%s'%num, lblsize=8))
    rjpins.append(elm.IcPin(name='', side='left', slot=slot, anchorname='L%s'%num))
rj=d.add(elm.Ic(pins=rjpins, edgepadH=0.5, edgepadW=1.2, pinspacing=1.5).at((14.5,3)))
lbl(15.6, 15.6, 'RJ-45  (F) panel jack\n(cable side (M) to opener)', 'black', 9)
L={k:P(rj,'L%d'%k) for k in range(1,9)}
R={k:P(rj,'R%d'%k) for k in range(1,9)}

# ===========================================================
#  Box internals
# ===========================================================
# --- 230 V mains (far top-left) ---
mains = place_ic(
    [elm.IcPin(name='L', side='right', slot='2/2', anchorname='L'),
     elm.IcPin(name='N', side='right', slot='1/2', anchorname='N')],
    'L', (2.0, 14.0), '230 V AC\nmains', fs=9,
    edgepadW=1.2, edgepadH=0.6, pinspacing=1.5, leadlen=0.6)

# --- Shelly 1 Gen3 (controller) -- above the i4, drives orange pair ---
s1 = place_ic(
    [elm.IcPin(name='L', side='left', slot='2/2', anchorname='Lin'),
     elm.IcPin(name='N', side='left', slot='1/2', anchorname='Nin'),
     elm.IcPin(name='O', side='right', slot='2/2', anchorname='O'),
     elm.IcPin(name='I', side='right', slot='1/2', anchorname='I')],
    'O', (7.5, 14.0), 'Shelly 1\nGen3 (S1)\nCONTROLLER\nrelay=1 pulse', fs=9,
    edgepadW=1.6, edgepadH=0.9, pinspacing=1.5, leadlen=0.7)

# --- USB charger (below mains): 230 V in on TOP, 5 V out on RIGHT ---
usb = place_ic(
    [elm.IcPin(name='L', side='top', slot='1/2', anchorname='Lin'),
     elm.IcPin(name='N', side='top', slot='2/2', anchorname='Nin'),
     elm.IcPin(name='+5V', side='right', slot='2/2', anchorname='V5'),
     elm.IcPin(name='-', side='right', slot='1/2', anchorname='GND')],
    'V5', (3.2, 8.0), 'USB charger\n230 V to 5 V', fs=9,
    edgepadW=1.5, edgepadH=0.8, pinspacing=1.4, leadlen=0.7)

# --- Shelly Plus i4 DC (monitor) -- right pins aligned to RJ-45 5..8 ---
i4 = place_ic(
    [elm.IcPin(name='+5V', side='left', slot='4/6', anchorname='V5'),
     elm.IcPin(name='-', side='left', slot='3/6', anchorname='GND'),
     elm.IcPin(name='SW3', side='right', slot='6/6', anchorname='SW3'),
     elm.IcPin(name='SW4', side='right', slot='5/6', anchorname='SW4'),
     elm.IcPin(name='SW1', side='right', slot='4/6', anchorname='SW1'),
     elm.IcPin(name='-', side='right', slot='3/6', anchorname='C1'),
     elm.IcPin(name='SW2', side='right', slot='2/6', anchorname='SW2'),
     elm.IcPin(name='-', side='right', slot='1/6', anchorname='C2')],
    'SW1', (8.6, 8.0), 'Shelly Plus\ni4 DC\nMONITOR\nderives\nstate', fs=9,
    edgepadW=1.7, edgepadH=0.45, pinspacing=1.5, leadlen=0.7)

# ===========================================================
#  Motor-sense opto board (mirrored: LED -> RJ-45 ; transistor -> i4)
# ===========================================================
def opto_at(collector_target):
    cx, cy = collector_target
    return d.add(elm.Optocoupler(box=True).at((cx+0.45, cy+0.05)).reverse())

oc1 = opto_at((9.8, 11.8))   # opening -> SW3 (sits above pin5, below the orange I wire)
oc2 = opto_at((9.8, 10.0))   # closing -> SW4
a1=P(oc1,'anode'); k1=P(oc1,'cathode'); c1=P(oc1,'collector'); e1=P(oc1,'emitter')
a2=P(oc2,'anode'); k2=P(oc2,'cathode'); c2=P(oc2,'collector'); e2=P(oc2,'emitter')
lbl(9.9, 12.05, 'OPTO1', GOLD, 6.5, 'left')
lbl(9.9, 8.45,  'OPTO2', GOLD, 6.5, 'left')

xBLK=13.0; xRED=13.6
# anti-parallel: both 10k on the RED-rail side (R1 top, R2 bottom); BLACK rail = 2 plain jumpers
r1=d.add(elm.Resistor().at(a1).to((xRED,a1[1])).label('R1 10k', fontsize=7, loc='top').color('#333').linewidth(2))   # anode1 -> RED
r2=d.add(elm.Resistor().at(k2).to((xRED,k2[1])).label('R2 10k', fontsize=7, loc='bottom').color('#333').linewidth(2)) # cathode2 -> RED
seg([k1,(xBLK,k1[1])], BLK, lw=2)        # OPTO1 cathode -> BLACK rail
seg([a2,(xBLK,a2[1])], BLK, lw=2)        # OPTO2 anode  -> BLACK rail
seg([(xRED,k2[1]),(xRED,a1[1])], RED, lw=2.6)        # RED rail (reaches pin3)
seg([(xBLK,L[4][1]),(xBLK,k1[1])], BLK, lw=2.6)      # BLACK rail (extended down to pin4)
for p,c in [((xRED,a1[1]),RED),((xRED,k2[1]),RED),((xBLK,k1[1]),BLK),((xBLK,a2[1]),BLK)]: dot(p,c)
lbl(xRED+0.2, a1[1]+0.45, 'RED', RED, 7, 'left')
lbl(xBLK-0.2, (k1[1]+a2[1])/2, 'BLK', BLK, 7, 'right')
# rails -> RJ-45 pins 3 (RED) / 4 (BLACK) as the GREEN Cat5 pair
seg([(xRED,L[3][1]), L[3]], GRN, lw=2.4)
seg([(xBLK,L[4][1]), L[4]], GRN, '--', lw=2.4)
dot((xRED,L[3][1]),RED); dot((xBLK,L[4][1]),BLK)

# transistor collectors -> i4 SW3 / SW4 (short left channel)
hjog(c1, P(i4,'SW3'), 8.9, ISO, lw=2)
hjog(c2, P(i4,'SW4'), 9.1, ISO, lw=2)
# emitters -> common bus -> i4 upper '-'
xEB=9.3
seg([e1,(xEB,e1[1])], GND, lw=2); seg([e2,(xEB,e2[1])], GND, lw=2)
seg([(xEB,e2[1]),(xEB,e1[1])], GND, lw=2)
seg([(xEB,e1[1]),(xEB,P(i4,'C1')[1])], GND, lw=2)   # bus down to the i4 '-' / pin6 return net
dot((xEB,e1[1]),GND); dot((xEB,e2[1]),GND); dot((xEB,P(i4,'C1')[1]),GND)
# board outline + title (in clear space above the board)
d.add(elm.EncircleBox([oc1,oc2,r1,r2], padx=0.3, pady=0.3).color(GOLD).linestyle('--'))
lbl(11.0, 15.2, 'Motor-sense opto board  -  2x PS2501 anti-parallel + 2x 10k  -  5 kV iso\n'
                'OPTO1 = opening (-> SW3)      OPTO2 = closing (-> SW4)', GOLD, 8)

# ===========================================================
#  Power wiring
# ===========================================================
Lm=P(mains,'L'); Nm=P(mains,'N'); uL=P(usb,'Lin'); uN=P(usb,'Nin')
seg([Lm, P(s1,'Lin')], REDL)                              # mains L -> S1
seg([Nm, P(s1,'Nin')], NBLU)                              # mains N -> S1
dot((2.6,Lm[1]),REDL); dot((2.9,Nm[1]),NBLU)
seg([(2.6,Lm[1]),(2.6,uL[1]),uL], REDL)                   # L tap -> USB top
seg([(2.9,Nm[1]),(2.9,uN[1]),uN], NBLU)                   # N tap -> USB top
seg([P(usb,'V5'), P(i4,'V5')], V5)                        # USB +5V -> i4
hjog(P(usb,'GND'), P(i4,'GND'), (P(usb,'GND')[0]+P(i4,'GND')[0])/2, GND)

# ===========================================================
#  S1 relay -> RJ-45 pins 1/2 (orange = impulse)
# ===========================================================
seg([P(s1,'O'), L[1]], ORG, lw=2.4)
seg([P(s1,'I'), L[2]], ORG, '--', lw=2.4)

# ===========================================================
#  i4 reeds -> RJ-45 pins 5/6/7/8 (blue + brown)
# ===========================================================
seg([P(i4,'SW1'), L[5]], BLU, lw=2.4)
seg([P(i4,'C1'), (12.6,P(i4,'C1')[1]),(12.6,L[6][1]), L[6]], BLU, '--', lw=2.4)
seg([P(i4,'SW2'), L[7]], BRN, lw=2.4)
seg([P(i4,'C2'), L[8]], BRN, '--', lw=2.4)

# ===========================================================
#  Destinations (far right) + full 8-wire Cat5
# ===========================================================
def dest(target, label):
    return place_ic(
        [elm.IcPin(name='', side='left', slot='2/2', anchorname='hi'),
         elm.IcPin(name='', side='left', slot='1/2', anchorname='lo')],
        'hi', target, label, fs=8,
        edgepadW=3.6, edgepadH=0.7, pinspacing=1.5, leadlen=0.5)

eco=dest((20.7,14.0), 'EcoStar B impulse\nT2=ORG   T1=W/ORG\nwall button || (D-04)')
mot=dest((20.7,11.0), 'Motor leads (sense)\nRED=GRN   BLK=W/GRN\n+/-19..24 V, opto side only')
rc =dest((20.7, 8.0), 'Reed CLOSED  NC\nSW1=BLU   com=W/BLU\nmagnet=closed (floor)')
ro =dest((20.7, 5.0), 'Reed OPEN  NC\nSW2=BRN   com=W/BRN\nfail-safe (top)')
cable=[(1,eco,'hi',ORG,'-'),(2,eco,'lo',ORG,'--'),(3,mot,'hi',GRN,'-'),(4,mot,'lo',GRN,'--'),
       (5,rc,'hi',BLU,'-'),(6,rc,'lo',BLU,'--'),(7,ro,'hi',BRN,'-'),(8,ro,'lo',BRN,'--')]
for num,box,anc,col,ls in cable:
    seg([R[num], P(box,anc)], col, ls, lw=2.4)

# ===========================================================
#  title + notes
# ===========================================================
lbl(11, 16.6, 'EcoStar Garage - Final In-Box Wiring and RJ-45 Pinout (NON-STANDARD, pair-by-pair)', 'black', 12)
notes=('NOTES   * Pinout NOT T568: one twisted pair per adjacent pin-pair  1-2 / 3-4 / 5-6 / 7-8.'
       '   * 230 V splits in-box to S1 + USB charger; 5 V feeds the i4 (not EcoStar 24 V).\n'
       '          * Opto: RED-R1-LED1-BLACK = OPTO1-SW3 (opening);  BLACK-LED2-R2-RED = OPTO2-SW4 (closing); 0 V = both off.'
       '   * Reeds NC (magnet=closed). Wall button || T1-T2 keeps working with Wi-Fi down (D-04).')
lbl(11, 1.3, notes, '#444', 7.5)

# ---- overlap self-check (printed, not drawn) ----
def overlap(a,b):
    ax0,ay0,ax1,ay1=a; bx0,by0,bx1,by1=b
    ix=max(0,min(ax1,bx1)-max(ax0,bx0)); iy=max(0,min(ay1,by1)-max(ay0,by0))
    return ix*iy
boxes={'mains':mains._extent,'s1':s1._extent,'usb':usb._extent,'i4':i4._extent,
       'eco':eco._extent,'mot':mot._extent,'rc':rc._extent,'ro':ro._extent}
import itertools
for n1,n2 in itertools.combinations(boxes,2):
    ar=overlap(boxes[n1],boxes[n2])
    if ar>0.05: print("OVERLAP %s/%s area=%.2f"%(n1,n2,ar))
for n,e in boxes.items(): print("%-6s x[%.2f,%.2f] y[%.2f,%.2f]"%(n,e[0],e[2],e[1],e[3]))

d.save(OUT+'.svg')
d.save(OUT+'.png', dpi=150)
print("rendered ->", OUT+'.svg', "/", OUT+'.png')
