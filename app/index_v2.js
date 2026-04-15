const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || 'B';
const START   = Date.now();

app.use(express.json());

// ─── Datos de ejemplo ───────────────────────────────────────────────────────

const productos = [
  { id: 1, nombre: 'Laptop Pro 15',    precio: 2499.99, stock: 12, categoria: 'Electrónica' },
  { id: 2, nombre: 'Teclado Mecánico', precio:  129.99, stock: 45, categoria: 'Periféricos' },
  { id: 3, nombre: 'Monitor 4K 27"',   precio:  699.99, stock: 8,  categoria: 'Electrónica' },
  { id: 4, nombre: 'Mouse Inalámbrico',precio:   49.99, stock: 80, categoria: 'Periféricos' },
  { id: 5, nombre: 'Auriculares BT',   precio:  199.99, stock: 30, categoria: 'Audio'       },
];

// ─── Caché en memoria (optimización Versión B) ───────────────────────────────

const cache    = new Map();
const CACHE_TTL = 30 * 1000; // 30 segundos

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ─── GET / — API Landing (status profesional) ────────────────────────────────

app.get('/', (req, res) => {
  const uptimeMs  = Date.now() - START;
  const uptimeSeg = Math.floor(uptimeMs / 1000);
  const horas     = Math.floor(uptimeSeg / 3600);
  const minutos   = Math.floor((uptimeSeg % 3600) / 60);
  const segundos  = uptimeSeg % 60;

  res.json({
    servicio    : 'EcommerceAPI',
    version     : VERSION,
    estado      : 'operativo',
    uptime      : `${horas}h ${minutos}m ${segundos}s`,
    timestamp   : new Date().toISOString(),
    cache       : { entradas: cache.size, ttl_seg: CACHE_TTL / 1000 },
    endpoints   : [
      { metodo: 'GET',  ruta: '/productos',      descripcion: 'Lista todos los productos (cacheado)'  },
      { metodo: 'GET',  ruta: '/producto/:id',   descripcion: 'Detalle de un producto (cacheado)'     },
      { metodo: 'GET',  ruta: '/buscar?q=texto', descripcion: 'Búsqueda de productos (cacheado)'      },
      { metodo: 'POST', ruta: '/carrito',        descripcion: 'Agregar producto al carrito'            },
      { metodo: 'GET',  ruta: '/health',         descripcion: 'Estado del servicio (CI/CD)'            },
    ],
  });
});

// ─── GET /health ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status    : 'ok',
    version   : VERSION,
    uptime_ms : Date.now() - START,
    cache_size: cache.size,
    timestamp : new Date().toISOString(),
  });
});

// ─── GET /productos ──────────────────────────────────────────────────────────

app.get('/productos', (req, res) => {
  const KEY    = 'todos';
  const cached = getCache(KEY);
  if (cached) return res.json({ version: VERSION, cache: true,  total: cached.length, productos: cached });
  setCache(KEY, productos);
  res.json({ version: VERSION, cache: false, total: productos.length, productos });
});

// ─── GET /producto/:id ───────────────────────────────────────────────────────

app.get('/producto/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const KEY = `producto_${id}`;

  const cached = getCache(KEY);
  if (cached) return res.json({ version: VERSION, cache: true, producto: cached });

  const producto = productos.find(p => p.id === id);
  if (!producto) {
    return res.status(404).json({ error: 'Producto no encontrado', id: req.params.id });
  }
  setCache(KEY, producto);
  res.json({ version: VERSION, cache: false, producto });
});

// ─── GET /buscar ─────────────────────────────────────────────────────────────

app.get('/buscar', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) {
    return res.status(400).json({ error: 'Parámetro q requerido. Ej: /buscar?q=laptop' });
  }

  const KEY    = `buscar_${q}`;
  const cached = getCache(KEY);
  if (cached) return res.json({ version: VERSION, cache: true,  query: q, total: cached.length, resultados: cached });

  const resultados = productos.filter(p =>
    p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q)
  );
  setCache(KEY, resultados);
  res.json({ version: VERSION, cache: false, query: q, total: resultados.length, resultados });
});

// ─── POST /carrito ───────────────────────────────────────────────────────────

app.post('/carrito', (req, res) => {
  const { productoId, cantidad } = req.body;

  if (!productoId || !cantidad) {
    return res.status(400).json({ error: 'Se requiere productoId y cantidad' });
  }

  const producto = productos.find(p => p.id === parseInt(productoId));
  if (!producto) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }
  if (cantidad > producto.stock) {
    return res.status(409).json({ error: 'Stock insuficiente', disponible: producto.stock });
  }

  const subtotal = parseFloat((producto.precio * cantidad).toFixed(2));

  res.status(201).json({
    version   : VERSION,
    mensaje   : 'Producto agregado al carrito',
    item      : { producto: producto.nombre, cantidad, precioUnit: producto.precio, subtotal },
  });
});

// ─── 404 genérico ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error     : 'Ruta no encontrada',
    ruta      : req.originalUrl,
    sugerencia: 'Consulta GET / para ver los endpoints disponibles',
  });
});

// ─── Inicio ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[EcommerceAPI] Versión ${VERSION} (con caché) escuchando en puerto ${PORT}`);
});
