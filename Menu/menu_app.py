import pandas as pd
from PIL import Image, ImageDraw, ImageFont, ImageTk
import customtkinter as ctk
from tkinter import messagebox, Toplevel, Label, Button
from datetime import datetime

# =========================
# CONFIGURACIÓN
# =========================

PLANTILLA = "plantilla.png"

# Coordenadas (inicio de cada cuadro)
ROJO = (15, 630)
AZUL = (15, 1400)
AMARILLO = (15, 1750)

# Fuentes (RUTAS CORREGIDAS)
fuente_titulo = ImageFont.truetype("Fonts/Anton/Anton-Regular.ttf", 90)
fuente_texto = ImageFont.truetype("Fonts/Montserrat/static/Montserrat-SemiBold.ttf", 55)
fuente_precio = ImageFont.truetype("Fonts/Montserrat/static/Montserrat-ExtraBold.ttf", 65)

# Colores
COLOR_BLANCO = (255, 255, 255)
COLOR_AMARILLO = (255, 196, 0)
COLOR_SOMBRA = (0, 0, 0)

# =========================
# LEER EXCEL
# =========================

df = pd.read_excel("platos.xlsx")

sopas = df[df["Categoria"] == "Sopa"]
arroces = df[df["Categoria"] == "Arroz"]
proteinas = df[df["Categoria"] == "Proteina"]
acompanamientos = df[df["Categoria"] == "Acompañamiento"]

# =========================
# INTERFAZ CON SCROLL
# =========================

ctk.set_appearance_mode("light")
app = ctk.CTk()
app.title("Generador Menú - El Lobo")
app.geometry("520x750")

frame_scroll = ctk.CTkScrollableFrame(app, width=500, height=720)
frame_scroll.pack(fill="both", expand=True)

sopas_vars = []
arroces_vars = []
proteinas_vars = []
acompanamientos_vars = []

ctk.CTkLabel(frame_scroll, text="Selecciona las Sopas", font=("Arial", 18)).pack(pady=10)

for _, sopa in sopas.iterrows():
    var = ctk.BooleanVar()
    sopas_vars.append((var, sopa))
    ctk.CTkCheckBox(
        frame_scroll,
        text=sopa["Productos"],
        variable=var
    ).pack(anchor="w", padx=20)


ctk.CTkLabel(frame_scroll, text="Selecciona el Arroz", font=("Arial", 18)).pack(pady=10)

for _, arroz in arroces.iterrows():
    var = ctk.BooleanVar()
    arroces_vars.append((var, arroz))
    ctk.CTkCheckBox(
        frame_scroll,
        text=arroz["Productos"],
        variable=var
    ).pack(anchor="w", padx=20)


ctk.CTkLabel(frame_scroll, text="Selecciona las Proteínas", font=("Arial", 18)).pack(pady=10)

for _, proteina in proteinas.iterrows():
    var = ctk.BooleanVar()
    proteinas_vars.append((var, proteina))
    ctk.CTkCheckBox(
        frame_scroll,
        text=proteina["Productos"],
        variable=var
    ).pack(anchor="w", padx=20)

ctk.CTkLabel(frame_scroll, text="Selecciona los Acompañamientos", font=("Arial", 18)).pack(pady=10)

for _, acomp in acompanamientos.iterrows():
    var = ctk.BooleanVar()
    acompanamientos_vars.append((var, acomp))
    ctk.CTkCheckBox(
        frame_scroll,
        text=acomp["Productos"],
        variable=var
    ).pack(anchor="w", padx=20)

# =========================
# FUNCIÓN TEXTO CON SOMBRA
# =========================

def texto_con_sombra(draw, posicion, texto, fuente, color_texto):
    x, y = posicion
    draw.text((x+3, y+3), texto, font=fuente, fill=COLOR_SOMBRA)
    draw.text((x, y), texto, font=fuente, fill=color_texto)

# =========================
# CREAR IMAGEN
# =========================

def crear_imagen():

    sopas_sel = [s["Productos"] for v, s in sopas_vars if v.get()]
    arroces_sel = [a["Productos"] for v, a in arroces_vars if v.get()]
    proteinas_sel = [p["Productos"] for v, p in proteinas_vars if v.get()]
    acomp_sel = [a["Productos"] for v, a in acompanamientos_vars if v.get()]

    if not sopas_sel and not proteinas_sel:
        messagebox.showerror("Error", "Selecciona al menos un producto.")
        return None

    imagen = Image.open(PLANTILLA).convert("RGB")
    draw = ImageDraw.Draw(imagen)

    # -------- CUADRO ROJO --------
    x, y = ROJO

    for s in sopas_sel:
        texto_con_sombra(draw, (x, y), f"• {s}", fuente_texto, COLOR_BLANCO)
        y += 80

    for arroz in arroces_sel:
        texto_con_sombra(draw, (x, y), f"• {arroz}", fuente_texto, COLOR_BLANCO)
        y += 80

    for p in proteinas_sel:
        texto_con_sombra(draw, (x, y), f"• {p}", fuente_texto, COLOR_BLANCO)
        y += 80


    # -------- CUADRO AZUL --------
    x, y = AZUL

    for a in acomp_sel:
        texto_con_sombra(draw, (x, y), f"• {a}", fuente_texto, COLOR_BLANCO)
        y += 80

    # -------- CUADRO AMARILLO --------
    x, y = AMARILLO

    texto_fijo = [
        "Completo: $14.000",
        "Seco: $12.000",
        "Porción Sopa: $7.000",
        "Porción Arroz: $4.000",
        "Asado 130Gr: $17.000",
        "Asado 200Gr: $20.000"
    ]

    for linea in texto_fijo:
        texto_con_sombra(draw, (x, y), linea, fuente_precio, COLOR_AMARILLO)
        y += 75

    return imagen


# =========================
# VISTA PREVIA
# =========================

def vista_previa():

    imagen = crear_imagen()
    if imagen is None:
        return

    ventana = Toplevel(app)
    ventana.title("Vista Previa")

    img_preview = imagen.resize((500, 750))
    img_tk = ImageTk.PhotoImage(img_preview)

    label = Label(ventana, image=img_tk)
    label.image = img_tk
    label.pack()

    def guardar():
        fecha = datetime.now().strftime("%Y-%m-%d")
        nombre = f"menu.jpg"
        imagen.save(nombre)
        messagebox.showinfo("Guardado", f"Menú guardado como {nombre}")
        ventana.destroy()

    Button(ventana, text="Confirmar y Guardar", command=guardar).pack(pady=10)
    Button(ventana, text="Volver", command=ventana.destroy).pack()

# =========================
# BOTÓN CONTINUAR
# =========================

ctk.CTkButton(frame_scroll, text="Continuar", command=vista_previa).pack(pady=20)

app.mainloop()
