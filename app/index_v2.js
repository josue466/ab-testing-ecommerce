const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || 'B';

// Base de datos simulada de productos
const productos = [
  { id: 1, nombre: 'Laptop HP 15"',       precio: 2500.00, stock: 15, categoria: 'tecnologia' },
  { id: 2, nombre: 'Mouse Logitech MX',   precio: 85.00,   stock: 50, categoria: 'tecnologia' },
  { id: 3, nombre: 'Teclado Mecánico',    precio: 320.00,  stock: 30, categoria: 'tecnologia' },
  { id: 4, nombre: 'Monitor Samsung 24"', precio: 890.00,  stock: 10, categoria: 'tecnologia' },
  { id: 5, nombre: 'Audífonos Sony WH',   precio: 450.00,  stock: 25, categoria: 'audio'      },
  { id: 6, nombre: 'Cámara Canon EOS',    precio: 3200.00, stock: 8,  categoria: 'fotografia' },
  { id: 7, nombre: 'Tablet Samsung A8',   precio: 1200.00, stock: 20, categoria: 'tecnologia' },
  { id: 8, nombre: 'Parlante JBL Go 3',   precio: 180.00,  stock: 40, categoria: 'audio'      }
];

// Versión B — CON caché en memoria (más rápida)
const cache = {
  productos,
  porId: Object.fromEntries(productos.map(p => [p.id, p])),
  porCategoria: productos.reduce((acc, p) => {
    if (!acc[p.categoria]) acc[p.categoria] = [];
    acc[p.categoria].push(p);
    return acc;
  }, {})
};

const simularConsultaBD = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// GET /productos — con caché
app.get('/productos', async (req, res) => {
  await simularConsultaBD(15); // caché en memoria — mucho más rápido
  res.json({ version: VERSION, total: cache.productos.length, productos: cache.productos });
});

// GET /producto/:id — con caché por ID
app.get('/producto/:id', async (req, res) => {
  await simularConsultaBD(10);
  const producto = cache.porId[parseInt(req.params.id)];
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado', version: VERSION });
  res.json({ version: VERSION, producto });
});

// GET /buscar?q=texto — con índice por nombre
app.get('/buscar', async (req, res) => {
  await simularConsultaBD(20); // búsqueda con índice — más rápida
  const q = (req.query.q || '').toLowerCase();
  const resultados = cache.productos.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    p.categoria.toLowerCase().includes(q)
  );
  res.json({ version: VERSION, query: q, total: resultados.length, resultados });
});

// POST /carrito — con validación rápida
app.post('/carrito', async (req, res) => {
  await simularConsultaBD(12);
  const { productoId, cantidad } = req.body;
  const producto = cache.porId[parseInt(productoId)];
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado', version: VERSION });
  if (producto.stock < cantidad) return res.status(400).json({ error: 'Stock insuficiente', version: VERSION });
  res.json({
    version: VERSION,
    mensaje: 'Producto agregado al carrito',
    item: { producto: producto.nombre, cantidad, subtotal: producto.precio * cantidad }
  });
});

// GET /health
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', version: VERSION, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`[VERSION ${VERSION}] API Ecommerce OPTIMIZADA corriendo en puerto ${PORT}`));
