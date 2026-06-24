from PIL import Image, ImageDraw

imagen = Image.open("plantilla.png").convert("RGB")
draw = ImageDraw.Draw(imagen)

# ROJO
draw.rectangle([15, 630, 800, 1290], outline="red", width=8)

# AZUL
draw.rectangle([15, 1400, 800, 1630], outline="blue", width=8)

# AMARILLO
draw.rectangle([15, 1750, 800, 2200], outline="yellow", width=8)

imagen.save("zonas_definitivas.jpg")

print("Zonas generadas")
