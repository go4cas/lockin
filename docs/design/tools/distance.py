# Simulate viewing a 1080p display frame from N screen-heights away with a given acuity (arcmin per resolvable detail).
import sys, math
from PIL import Image, ImageDraw
src,out,ratio,acuity=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4])
im=Image.open(src).convert("RGB"); W,H=im.size
deg=2*math.degrees(math.atan(0.5/ratio)); px=int(deg*60/acuity)
small=im.resize((max(1,int(W*px/H)),px),Image.LANCZOS)
small.resize((W,H),Image.BICUBIC).save(out)
print(out, "effective lines", px)
