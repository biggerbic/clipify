# Generates resources/icon.png (app) and resources/trayTemplate.png (macOS menu bar) with Pillow.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([64, 64, S - 64, S - 64], radius=220, fill=(10, 17, 19, 255), outline=(95, 227, 192, 90), width=6)
# a 9:16 frame with a play notch: the "clip"
d.rounded_rectangle([352, 232, 672, 792], radius=56, outline=(95, 227, 192, 255), width=44)
d.polygon([(468, 412), (468, 612), (620, 512)], fill=(95, 227, 192, 255))
img.save(f'{out}/icon.png')
T = 64
t = Image.new('RGBA', (T, T), (0, 0, 0, 0))
td = ImageDraw.Draw(t)
td.rounded_rectangle([18, 6, 46, 58], radius=7, outline=(0, 0, 0, 255), width=5)
td.polygon([(28, 22), (28, 42), (40, 32)], fill=(0, 0, 0, 255))
t.save(f'{out}/trayTemplate.png')
print('icons written')
