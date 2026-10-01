# Truquito 🃏

Anotador de **Truco Uruguayo** con historial de partidas, jugadores, estadísticas y ranking (Elo).
Es un sitio estático: HTML + CSS + JavaScript, sin build ni dependencias.

## Qué tiene

- **Anotador**: palitos en cuadraditos de a 5, malas y buenas (a 30 o a 40), 1v1 / 2v2 / 3v3, con o sin flor.
  - Tocás los palitos y suma 1. Botones +1 / +2 / +3 / −1 por equipo.
  - Botones **Envido**, **Truco** y **Flor** con todas las jugadas (real envido, falta, retruco, vale cuatro, no quiso, contraflor al resto…).
  - Deshacer todo, incluso el punto que cierra la partida. La pantalla no se apaga mientras jugás.
- **Historial**: partidas por día, filtro por jugador, gráfico de cómo fue la partida y puntos por envido/truco/flor. Revancha con un toque.
- **Jugadores**: perfil con partidas, % de victorias, Elo, rachas, últimas 10, con quién gana más y contra quién juega.
- **Ranking**: por Elo, victorias, % o partidas jugadas.
- **Grupo en la nube** (opcional): todos los de la barra ven el mismo historial desde su celular.
- Backup en JSON, modo claro/oscuro, se puede "instalar" en el celular (Compartir → Agregar a inicio).

## Probarlo en tu compu

```bash
cd truquito
python3 -m http.server 8000
# abrí http://localhost:8000
```

(Hace falta un servidor; abrir el `index.html` con doble clic no anda porque usa módulos JS.)

## Publicarlo gratis

**Opción A — Vercel** (recomendado)
1. Subí la carpeta a un repo de GitHub.
2. En vercel.com → *Add New Project* → elegí el repo → *Framework: Other* → Deploy. Listo.

**Opción B — Netlify Drop**: arrastrá la carpeta a https://app.netlify.com/drop.

**Opción C — GitHub Pages**: repo → Settings → Pages → Branch `main` / root.

## Compartir el historial entre celulares (Supabase, gratis)

Sin esto, cada celular guarda sus partidas por separado.

1. Creá un proyecto en https://supabase.com.
2. En **SQL Editor** pegá el contenido de `supabase.sql` y dale **Run**.
3. En **Project Settings → API** copiá la *Project URL* y la *anon public key*.
4. Pegalas en `config.js`:
   ```js
   window.TRUQUITO_CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
   };
   ```
5. Volvé a publicar. En la web: **Ajustes → Grupo en la nube** → poné un código (ej. `barra-jueves-2026`) → *Unirme*.
6. *Copiar link de invitación* y mandalo por WhatsApp: el que entra por ese link queda en el mismo grupo.

> El código del grupo funciona como contraseña: el que lo sepa puede ver y editar ese grupo. Para una barra de amigos alcanza; si algún día querés cuentas con login, se puede agregar Supabase Auth.

Cómo sincroniza: cada celular guarda localmente y cada pocos segundos mezcla sus datos con los de la nube (jugador por jugador, partida por partida, gana el cambio más nuevo). Funciona sin internet y se pone al día cuando vuelve.

## Archivos

```
index.html            estructura y navegación
styles.css            estilos (modo claro/oscuro)
config.js             claves de Supabase (opcional)
js/store.js           datos, guardado local y sincronización
js/stats.js           estadísticas, ranking y Elo
js/app.js             pantallas y anotador
supabase.sql          tabla para la nube
manifest.webmanifest  para instalarla en el celular
```

## Reglas que usa

- A 30: 15 malas + 15 buenas. A 40: 20 + 20.
- Falta envido y contraflor al resto = lo que le falta al que va ganando para ganar la partida. Si en tu mesa se cuenta distinto, en cada jugada está "Otro valor".
- El ranking solo cuenta partidas terminadas con jugadores cargados. El Elo arranca en 1000 (K=32; en parejas usa el promedio del equipo).
