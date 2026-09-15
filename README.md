# Rhythm Arena

Juego de ritmo multijugador por salas (estilo Guitar Hero). El anfitrión sube una canción,
el navegador genera el beatmap con FFT multibanda y todos los jugadores de la sala empiezan
en el mismo instante.

## Estructura

```
rhythm-arena/
├── package.json
├── server.js
├── public/
│   ├── index.html
│   ├── style.css
│   ├── engine.js        (análisis FFT, juicio, puntuación, vida)
│   ├── characters.js    (15 personajes + escenario, dibujados por código)
│   ├── game.js
│   └── assets/stage-bg.jpg
└── tests/
    └── audit.js
```

El servidor también arranca si **todos** los archivos están en la misma carpeta que `server.js`
(sin `public/`). Si no encuentra `index.html` muestra una página de ayuda en vez de fallar.

## Ejecución

```bash
npm install
npm start
# abre http://localhost:3000
```

Variables opcionales: `PORT`, `HOST`, `PUBLIC_DIR`.

Para jugar desde otros dispositivos de la misma red, usa la IP local del anfitrión
(`http://192.168.x.x:3000`).

## Menú

- **Jugar solo** — tu música, tu récord, sin servidor.
- **Multijugador** — crear sala o entrar con código de 4 caracteres (hasta 4 jugadores).
- **Personajes** — 15 estrellas dibujadas por código; en sala cada personaje es exclusivo.
- **Opciones** — reasignar las teclas de los 6 carriles, latencia, volumen, audio progresivo,
  sistema de vida, escenario y pantallas de los compañeros.

## Cómo se juega

1. Elige personaje: aparece tocando en el escenario, junto al resto de la banda.
2. El anfitrión sube un MP3/WAV/OGG, elige dificultad y pulsa *Iniciar partida*.
   El audio y el beatmap viajan por Socket.io y todos arrancan con el mismo `startAt`
   (relojes alineados con un ping estilo NTP).
3. Carriles según dificultad: **Fácil y Normal 4** (`A S D F`), **Difícil 5** (`+G`),
   **Experto 6** (`+H`). También sirven las flechas en 4 carriles y el toque en pantalla.
4. Ventanas: PERFECT 55 ms · GREAT 100 ms · GOOD 155 ms. Multiplicador x2/x3/x4 a los
   10/20/30 de combo.
5. **Audio progresivo**: al fallar, la música se corta; vuelve en cuanto aciertas, así que
   la canción suena de corrido solo si tocas bien.
6. **Vida**: cada fallo la baja y cada acierto la recupera. Si llega a cero, se cierran las
   puertas y sale *JUEGO TERMINADO*. En solo puedes reintentar; **en línea la canción sigue**,
   quedas inactivo y ves en vivo las pantallas de tus compañeros.
7. Al terminar, ranking con puntuación, acertadas, falladas, combo máximo y precisión.
   Los eliminados quedan por debajo de quienes acabaron la canción.

Si las notas se sienten desfasadas, ajusta el deslizador de latencia en Opciones.

## Auditoría

```bash
npm run audit
```

Siete agentes independientes: estructura/HTTP, motor de análisis (FFT vs DFT de referencia,
recall/precisión/tempo y carriles por dificultad), reglas de juego y sistema de vida,
multijugador con 5 clientes reales (personajes, vida, eliminación, ranking), robustez/seguridad,
roster y dibujo de los 15 personajes, y cliente completo en DOM simulado (jsdom) cubriendo
menú, personajes, opciones, partida solo con game over y partida en red a 5 carriles.
