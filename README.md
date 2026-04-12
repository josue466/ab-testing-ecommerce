# 📊 Pipeline CI/CD con A/B Testing Automatizado — API Ecommerce

Pipeline que despliega dos versiones de una API de ventas simultáneamente,
mide el rendimiento con usuarios concurrentes, calcula un scoring ponderado
y promueve automáticamente la versión ganadora a producción.

---

## 📁 Estructura

```
ab-testing-ecommerce/
├── app/
│   ├── index.js          # Versión A — sin caché (actual)
│   ├── index_v2.js       # Versión B — con caché (optimizada)
│   └── package.json
├── Dockerfile.version-a
├── Dockerfile.version-b
├── docker-compose.yml    # Solo Jenkins
├── Jenkinsfile           # Pipeline de 9 etapas
├── deployment-history.json  # Historial de deploys
└── .gitignore
```

---

## 🔄 Pipeline de 9 Etapas

1. Checkout + leer historial
2. Build Versión A y B
3. Deploy simultáneo (puertos 3001 y 3002)
4. Simulación de carga concurrente + P95
5. Scoring ponderado (60% velocidad + 40% errores)
6. Promover ganadora a Producción (puerto 3000)
7. Health Check + Rollback automático
8. Actualizar deployment-history.json en GitHub
9. Generar Reporte HTML con Chart.js

---

## 🐳 Levantar Jenkins

```bash
docker-compose up -d
```

Accede en: http://localhost:8080

---

## 🌐 Endpoints de la API

| Endpoint         | Método | Descripción              |
|------------------|--------|--------------------------|
| /productos       | GET    | Lista todos los productos|
| /producto/:id    | GET    | Detalle de un producto   |
| /buscar?q=texto  | GET    | Búsqueda de productos    |
| /carrito         | POST   | Agregar al carrito       |
| /health          | GET    | Estado del servicio      |

---

## 🎯 Puertos

| Contenedor     | Puerto | Cuándo                        |
|----------------|--------|-------------------------------|
| jenkins        | 8080   | Siempre                       |
| api-ver-a      | 3001   | Solo durante A/B Testing      |
| api-ver-b      | 3002   | Solo durante A/B Testing      |
| api-produccion | 3000   | Siempre (versión ganadora)    |
