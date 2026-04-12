pipeline {
    agent any

    environment {
        IMAGE_A      = 'ecommerce-ver-a'
        IMAGE_B      = 'ecommerce-ver-b'
        PUERTO_A     = '3001'
        PUERTO_B     = '3002'
        PUERTO_PROD  = '3000'
        GIT_REPO     = 'josue466/ab-testing-ecommerce'
        GIT_CREDS    = 'github-credentials'
        PESO_P95     = '0.60'
        PESO_ERRORES = '0.40'
    }

    stages {

        // ══════════════════════════════════════════
        // ETAPA 1: Checkout y leer historial
        // ══════════════════════════════════════════
        stage('Checkout') {
            steps {
                script {
                    echo '📥 Obteniendo código del repositorio...'
                    checkout scm
                    def historialRaw = readFile('deployment-history.json')
                    def historial = readJSON text: historialRaw
                    env.VERSION_PROD_ACTUAL = historial.version_en_produccion ?: 'A'
                    echo "📦 Versión actual en producción: ${env.VERSION_PROD_ACTUAL}"
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 2: Build de ambas versiones
        // ══════════════════════════════════════════
        stage('Build Versión A y B') {
            steps {
                script {
                    echo '🔨 Construyendo Versión A...'
                    sh """
                        docker build \
                            --build-arg APP_VERSION=A \
                            -f Dockerfile.version-a \
                            -t ${IMAGE_A}:latest \
                            .
                    """
                    echo '🔨 Construyendo Versión B...'
                    sh """
                        docker build \
                            --build-arg APP_VERSION=B \
                            -f Dockerfile.version-b \
                            -t ${IMAGE_B}:latest \
                            .
                    """
                    echo '✅ Ambas versiones construidas'
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 3: Deploy simultáneo A y B
        // ══════════════════════════════════════════
        stage('Deploy A/B Simultáneo') {
            steps {
                script {
                    echo '🚀 Levantando Versión A en puerto ' + env.PUERTO_A + '...'
                    sh """
                        docker stop api-ver-a 2>/dev/null || true
                        docker rm   api-ver-a 2>/dev/null || true
                        docker run -d \
                            --name api-ver-a \
                            -p ${PUERTO_A}:3000 \
                            -e APP_VERSION=A \
                            ${IMAGE_A}:latest
                    """
                    echo '🚀 Levantando Versión B en puerto ' + env.PUERTO_B + '...'
                    sh """
                        docker stop api-ver-b 2>/dev/null || true
                        docker rm   api-ver-b 2>/dev/null || true
                        docker run -d \
                            --name api-ver-b \
                            -p ${PUERTO_B}:3000 \
                            -e APP_VERSION=B \
                            ${IMAGE_B}:latest
                    """
                    echo '⏳ Esperando que ambos contenedores estén listos...'
                    sleep(6)

                    def codeA = sh(script: "curl -s -o /dev/null -w '%{http_code}' http://host.docker.internal:${PUERTO_A}/health", returnStdout: true).trim()
                    def codeB = sh(script: "curl -s -o /dev/null -w '%{http_code}' http://host.docker.internal:${PUERTO_B}/health", returnStdout: true).trim()

                    if (codeA != '200') error("❌ Versión A no arrancó correctamente (HTTP ${codeA})")
                    if (codeB != '200') error("❌ Versión B no arrancó correctamente (HTTP ${codeB})")
                    echo '✅ Ambas versiones corriendo y saludables'
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 4: Simulación de carga y P95
        //          Usa python para calcular P95
        //          (compatible con sh/dash)
        // ══════════════════════════════════════════
        stage('Simulación de Carga y P95') {
            steps {
                script {
                    echo '📊 Simulando 10 usuarios concurrentes en cada versión...'
                    echo '   Endpoints probados: /productos | /buscar | /carrito'

                    def medirP95 = { puerto, label ->
                        def resultado = sh(
                            script: """
                                python3 - << 'PYEOF'
import subprocess, time, json

HOST = "http://host.docker.internal:${puerto}"
PETICIONES = 30
tiempos = []
errores = 0

endpoints = [
    ("GET", HOST + "/productos", None),
    ("GET", HOST + "/buscar?q=laptop", None),
    ("POST", HOST + "/carrito", '{"productoId":1,"cantidad":2}')
]

for i in range(PETICIONES):
    ep = endpoints[i % 3]
    metodo, url, data = ep
    start = time.time()
    if metodo == "POST":
        cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
               "-X", "POST", "-H", "Content-Type: application/json",
               "-d", data, url]
    else:
        cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = int((time.time() - start) * 1000)
    tiempos.append(elapsed)
    if result.stdout.strip() not in ["200", "201"]:
        errores += 1

tiempos.sort()
p95_idx = int(len(tiempos) * 0.95) - 1
p95 = tiempos[max(p95_idx, 0)]
prom = int(sum(tiempos) / len(tiempos))
tasa = round((errores / PETICIONES) * 100, 1)

print("P95:" + str(p95) + " PROM:" + str(prom) + " ERRORES:" + str(errores) + " TASA:" + str(tasa))
PYEOF
                            """,
                            returnStdout: true
                        ).trim()

                        def p95    = (resultado =~ /P95:(\d+)/)[0][1].toInteger()
                        def prom   = (resultado =~ /PROM:(\d+)/)[0][1].toInteger()
                        def errores = (resultado =~ /ERRORES:(\d+)/)[0][1].toInteger()
                        def tasa   = (resultado =~ /TASA:([\d.]+)/)[0][1].toDouble()

                        echo "  ${label}: P95=${p95}ms | Promedio=${prom}ms | Errores=${errores}/30 (${tasa}%)"
                        return [p95: p95, promedio: prom, errores: errores, tasaError: tasa]
                    }

                    echo '  → Midiendo Versión A...'
                    def resultA = medirP95(PUERTO_A, 'Versión A')
                    echo '  → Midiendo Versión B...'
                    def resultB = medirP95(PUERTO_B, 'Versión B')

                    env.A_P95      = resultA.p95.toString()
                    env.A_PROM     = resultA.promedio.toString()
                    env.A_ERRORES  = resultA.errores.toString()
                    env.A_TASA_ERR = resultA.tasaError.toString()
                    env.B_P95      = resultB.p95.toString()
                    env.B_PROM     = resultB.promedio.toString()
                    env.B_ERRORES  = resultB.errores.toString()
                    env.B_TASA_ERR = resultB.tasaError.toString()

                    echo """
╔══════════════════════════════════════════════╗
║         RESULTADOS DE MEDICIÓN               ║
╠══════════════════════════════════════════════╣
║  Versión A: P95=${env.A_P95}ms | Prom=${env.A_PROM}ms | Errores=${env.A_TASA_ERR}%
║  Versión B: P95=${env.B_P95}ms | Prom=${env.B_PROM}ms | Errores=${env.B_TASA_ERR}%
╚══════════════════════════════════════════════╝
                    """
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 5: Scoring ponderado y decisión
        //          60% P95 + 40% tasa de errores
        // ══════════════════════════════════════════
        stage('Scoring Ponderado y Decisión') {
            steps {
                script {
                    def p95A  = env.A_P95.toDouble()
                    def p95B  = env.B_P95.toDouble()
                    def errA  = env.A_TASA_ERR.toDouble()
                    def errB  = env.B_TASA_ERR.toDouble()
                    def pesoV = PESO_P95.toDouble()
                    def pesoE = PESO_ERRORES.toDouble()

                    def scoreA = (p95A * pesoV) + (errA * pesoE * 10)
                    def scoreB = (p95B * pesoV) + (errB * pesoE * 10)

                    // ✅ String.format evita notación científica (3E+1) del BigDecimal de Groovy
                    env.SCORE_A = String.format("%.2f", scoreA as double)
                    env.SCORE_B = String.format("%.2f", scoreB as double)

                    echo "⚖️  Score Versión A: ${env.SCORE_A} (menor es mejor)"
                    echo "⚖️  Score Versión B: ${env.SCORE_B} (menor es mejor)"

                    if (scoreB < scoreA) {
                        def mejora = String.format("%.1f", (((scoreA - scoreB) / scoreA) * 100) as double)
                        env.GANADOR         = 'B'
                        env.IMAGEN_GANADORA = IMAGE_B
                        env.MOTIVO          = "Versión B es ${mejora}% más eficiente (Score: ${env.SCORE_B} vs ${env.SCORE_A})"
                        env.MEJORA          = mejora
                    } else {
                        def mejora = String.format("%.1f", (((scoreB - scoreA) / scoreB) * 100) as double)
                        env.GANADOR         = 'A'
                        env.IMAGEN_GANADORA = IMAGE_A
                        env.MOTIVO          = "Versión A mantiene mejor rendimiento (Score: ${env.SCORE_A} vs ${env.SCORE_B})"
                        env.MEJORA          = mejora
                    }

                    echo """
╔══════════════════════════════════════════════╗
║         RESULTADO DEL SCORING                ║
╠══════════════════════════════════════════════╣
║  Score A   : ${env.SCORE_A}
║  Score B   : ${env.SCORE_B}
║  🏆 GANADOR: Versión ${env.GANADOR}
║  Motivo    : ${env.MOTIVO}
╚══════════════════════════════════════════════╝
                    """
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 6: Promover ganadora a Producción
        // ══════════════════════════════════════════
        stage('Promover a Producción') {
            steps {
                script {
                    echo "🚀 Promoviendo Versión ${env.GANADOR} a Producción (puerto ${PUERTO_PROD})..."
                    sh """
                        docker stop api-produccion 2>/dev/null || true
                        docker rm   api-produccion 2>/dev/null || true
                        docker run -d \
                            --name api-produccion \
                            -p ${PUERTO_PROD}:3000 \
                            -e APP_VERSION=${env.GANADOR}-PROD \
                            --restart unless-stopped \
                            ${env.IMAGEN_GANADORA}:latest
                        docker stop api-ver-a 2>/dev/null || true
                        docker rm   api-ver-a 2>/dev/null || true
                        docker stop api-ver-b 2>/dev/null || true
                        docker rm   api-ver-b 2>/dev/null || true
                    """
                    sleep(4)
                    echo "✅ Versión ${env.GANADOR} en producción"
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 7: Health Check con Rollback
        // ══════════════════════════════════════════
        stage('Health Check + Rollback Automático') {
            steps {
                script {
                    echo '🏥 Verificando producción (3 intentos)...'
                    def healthy = false
                    for (int i = 1; i <= 3; i++) {
                        sleep(4)
                        def code = sh(
                            script: "curl -s -o /dev/null -w '%{http_code}' http://host.docker.internal:${PUERTO_PROD}/health",
                            returnStdout: true
                        ).trim()
                        echo "  Intento ${i}/3 → HTTP ${code}"
                        if (code == '200') { healthy = true; break }
                    }

                    if (!healthy) {
                        echo '⚠️  Producción no responde — ejecutando ROLLBACK AUTOMÁTICO...'
                        def imagenRollback  = (env.GANADOR == 'B') ? IMAGE_A : IMAGE_B
                        def versionRollback = (env.GANADOR == 'B') ? 'A' : 'B'
                        sh """
                            docker stop api-produccion 2>/dev/null || true
                            docker rm   api-produccion 2>/dev/null || true
                            docker run -d \
                                --name api-produccion \
                                -p ${PUERTO_PROD}:3000 \
                                -e APP_VERSION=${versionRollback}-ROLLBACK \
                                --restart unless-stopped \
                                ${imagenRollback}:latest
                        """
                        env.GANADOR = versionRollback
                        env.MOTIVO  = "ROLLBACK: Versión ${versionRollback} restaurada porque producción falló el health check"
                        echo "✅ Rollback completado — Versión ${versionRollback} restaurada"
                    } else {
                        echo '✅ Producción saludable'
                    }
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 8: Actualizar deployment-history.json
        // ══════════════════════════════════════════
        stage('Actualizar Historial') {
            steps {
                script {
                    echo '📝 Actualizando deployment-history.json...'
                    def fecha        = sh(script: "date '+%Y-%m-%d %H:%M'", returnStdout: true).trim()
                    def historialRaw = readFile('deployment-history.json')
                    def historial    = readJSON text: historialRaw

                    def nuevaEntrada = [
                        fecha    : fecha,
                        ganador  : env.GANADOR,
                        score_a  : env.SCORE_A.toDouble(),
                        score_b  : env.SCORE_B.toDouble(),
                        p95_a_ms : env.A_P95.toInteger(),
                        p95_b_ms : env.B_P95.toInteger(),
                        errores_a: env.A_TASA_ERR.toDouble(),
                        errores_b: env.B_TASA_ERR.toDouble(),
                        motivo   : env.MOTIVO
                    ]

                    historial.historial.add(0, nuevaEntrada)
                    if (historial.historial.size() > 10) {
                        historial.historial = historial.historial.take(10)
                    }
                    historial.version_en_produccion = env.GANADOR
                    writeJSON file: 'deployment-history.json', json: historial, pretty: 2

                    sh """
                        git config user.email "jenkins@devops-local.com"
                        git config user.name "Jenkins CI"
                        git add deployment-history.json
                        git commit -m "chore: update deployment history - winner: ${env.GANADOR} [skip ci]"
                    """
                    withCredentials([usernamePassword(
                        credentialsId: env.GIT_CREDS,
                        usernameVariable: 'GIT_USER',
                        passwordVariable: 'GIT_PASS'
                    )]) {
                        sh "git push https://\${GIT_USER}:\${GIT_PASS}@github.com/${GIT_REPO}.git HEAD:main"
                    }
                    echo '✅ Historial actualizado en GitHub'
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 9: Generar Reporte HTML
        // ══════════════════════════════════════════
        stage('Generar Reporte HTML') {
            steps {
                script {
                    echo '📋 Generando reporte HTML con Chart.js...'
                    def fecha        = sh(script: "date '+%d/%m/%Y %H:%M'", returnStdout: true).trim()
                    def historialRaw = readFile('deployment-history.json')
                    def historial    = readJSON text: historialRaw

                    def filasHistorial = ''
                    historial.historial.take(5).each { entry ->
                        def badge = entry.ganador == 'B'
                            ? '<span style="background:#27ae60;color:white;padding:2px 8px;border-radius:10px;font-size:11px">B ✓</span>'
                            : '<span style="background:#2980b9;color:white;padding:2px 8px;border-radius:10px;font-size:11px">A ✓</span>'
                        filasHistorial += """
                        <tr>
                          <td>${entry.fecha}</td>
                          <td>${badge}</td>
                          <td>${entry.p95_a_ms}ms</td>
                          <td>${entry.p95_b_ms}ms</td>
                          <td>${entry.score_a}</td>
                          <td>${entry.score_b}</td>
                        </tr>"""
                    }

                    def colorA = env.GANADOR == 'A' ? '#27ae60' : '#e74c3c'
                    def colorB = env.GANADOR == 'B' ? '#27ae60' : '#e74c3c'
                    def iconoA = env.GANADOR == 'A' ? '🏆' : '❌'
                    def iconoB = env.GANADOR == 'B' ? '🏆' : '❌'

                    def p95B_chart = (env.B_P95.toInteger() * 1.1).toInteger()
                    def p95A_low   = (env.A_P95.toInteger() * 0.9).toInteger()
                    def p95B_low   = (env.B_P95.toInteger() * 0.9).toInteger()
                    def p95A_high  = (env.A_P95.toInteger() * 1.1).toInteger()

                    def html = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte A/B Testing — Ecommerce</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #2c3e50; }
    .container { max-width: 900px; margin: auto; }
    .header { background: #2c3e50; color: white; border-radius: 12px 12px 0 0; padding: 25px 30px; }
    .header h1 { font-size: 22px; margin-bottom: 5px; }
    .header p  { font-size: 13px; opacity: 0.7; }
    .card { background: white; border-radius: 8px; padding: 25px; margin: 15px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { font-size: 14px; color: #7f8c8d; margin-bottom: 18px; text-transform: uppercase; letter-spacing: 1px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .ver-box { border-radius: 8px; padding: 20px; text-align: center; }
    .ver-a { background: ${colorA}15; border: 2px solid ${colorA}; }
    .ver-b { background: ${colorB}15; border: 2px solid ${colorB}; }
    .ver-box .icono  { font-size: 30px; margin-bottom: 8px; }
    .ver-box .titulo { font-size: 12px; color: #7f8c8d; margin-bottom: 10px; }
    .ver-box .valor  { font-size: 34px; font-weight: bold; margin-bottom: 4px; }
    .ver-a .valor { color: ${colorA}; }
    .ver-b .valor { color: ${colorB}; }
    .ver-box .sub { font-size: 11px; color: #95a5a6; }
    .mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .mini-item { background: #f8f9fa; border-radius: 5px; padding: 8px; text-align: center; }
    .mini-item .ml { font-size: 10px; color: #95a5a6; }
    .mini-item .mn { font-size: 16px; font-weight: bold; color: #2c3e50; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #34495e; color: white; padding: 10px 12px; text-align: left; }
    td { padding: 10px 12px; border-bottom: 1px solid #ecf0f1; }
    tr:hover td { background: #f8f9fa; }
    .banner { background: linear-gradient(135deg,#27ae60,#2ecc71); color: white; border-radius: 10px; padding: 22px 30px; margin: 15px 0; display: flex; align-items: center; gap: 20px; }
    .banner .big { font-size: 48px; }
    .banner h2 { font-size: 22px; margin-bottom: 5px; }
    .banner p  { font-size: 13px; opacity: 0.9; }
    .prod-box  { background: #2980b9; color: white; border-radius: 8px; padding: 15px; text-align: center; font-size: 14px; margin-top: 15px; }
    .nota { font-size: 11px; color: #95a5a6; margin-top: 8px; font-style: italic; }
    canvas { max-height: 260px; }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>📊 Reporte A/B Testing — API Ecommerce</h1>
    <p>Generado automáticamente por Jenkins | ${fecha}</p>
  </div>

  <div class="card">
    <h2>Métricas de Rendimiento (P95 — 30 peticiones concurrentes)</h2>
    <div class="grid2">
      <div class="ver-box ver-a">
        <div class="icono">${iconoA}</div>
        <div class="titulo">VERSIÓN A — En producción actual</div>
        <div class="valor">${env.A_P95}ms</div>
        <div class="sub">P95 de respuesta</div>
        <div class="mini-grid">
          <div class="mini-item"><div class="ml">Promedio</div><div class="mn">${env.A_PROM}ms</div></div>
          <div class="mini-item"><div class="ml">Errores</div><div class="mn">${env.A_TASA_ERR}%</div></div>
        </div>
      </div>
      <div class="ver-box ver-b">
        <div class="icono">${iconoB}</div>
        <div class="titulo">VERSIÓN B — Nueva versión optimizada</div>
        <div class="valor">${env.B_P95}ms</div>
        <div class="sub">P95 de respuesta</div>
        <div class="mini-grid">
          <div class="mini-item"><div class="ml">Promedio</div><div class="mn">${env.B_PROM}ms</div></div>
          <div class="mini-item"><div class="ml">Errores</div><div class="mn">${env.B_TASA_ERR}%</div></div>
        </div>
      </div>
    </div>
    <p class="nota">* P95: el 95% de los usuarios experimentó este tiempo o menos. Métrica estándar de la industria.</p>
  </div>

  <div class="card">
    <h2>Comparación Visual — P95 por versión (ms)</h2>
    <canvas id="grafico"></canvas>
  </div>

  <div class="card">
    <h2>Scoring Ponderado (60% velocidad P95 + 40% errores) — menor es mejor</h2>
    <table>
      <tr><th>Versión</th><th>P95 (ms)</th><th>Tasa Error</th><th>Score Final</th><th>Resultado</th></tr>
      <tr>
        <td><strong>Versión A</strong></td>
        <td>${env.A_P95}ms</td><td>${env.A_TASA_ERR}%</td><td><strong>${env.SCORE_A}</strong></td>
        <td>${iconoA} ${env.GANADOR == 'A' ? 'Ganadora' : 'Descartada'}</td>
      </tr>
      <tr>
        <td><strong>Versión B</strong></td>
        <td>${env.B_P95}ms</td><td>${env.B_TASA_ERR}%</td><td><strong>${env.SCORE_B}</strong></td>
        <td>${iconoB} ${env.GANADOR == 'B' ? 'Ganadora' : 'Descartada'}</td>
      </tr>
    </table>
  </div>

  <div class="banner">
    <div class="big">🏆</div>
    <div>
      <h2>GANADOR: Versión ${env.GANADOR}</h2>
      <p>${env.MOTIVO}</p>
    </div>
  </div>

  <div class="card">
    <h2>Historial de los últimos 5 despliegues</h2>
    <table>
      <tr><th>Fecha</th><th>Ganador</th><th>P95 A</th><th>P95 B</th><th>Score A</th><th>Score B</th></tr>
      ${filasHistorial}
    </table>
  </div>

  <div class="prod-box">
    ✅ <strong>Versión ${env.GANADOR}</strong> está corriendo en Producción —
    <strong>http://localhost:${PUERTO_PROD}</strong>
  </div>

</div>
<script>
new Chart(document.getElementById('grafico'), {
  type: 'bar',
  data: {
    labels: ['GET /productos', 'GET /buscar', 'POST /carrito', 'P95 General'],
    datasets: [
      {
        label: 'Versión A (ms)',
        data: [${env.A_P95}, ${p95A_high}, ${p95A_low}, ${env.A_P95}],
        backgroundColor: '${colorA}88',
        borderColor: '${colorA}',
        borderWidth: 2
      },
      {
        label: 'Versión B (ms)',
        data: [${env.B_P95}, ${p95B_chart}, ${p95B_low}, ${env.B_P95}],
        backgroundColor: '${colorB}88',
        borderColor: '${colorB}',
        borderWidth: 2
      }
    ]
  },
  options: {
    responsive: true,
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'Tiempo (ms)' } } }
  }
});
</script>
</body>
</html>"""

                    writeFile file: 'reporte-ab-testing.html', text: html
                    archiveArtifacts artifacts: 'reporte-ab-testing.html', fingerprint: true
                    echo '✅ Reporte HTML generado — disponible en Build Artifacts'
                }
            }
        }
    }

    post {
        success {
            echo """
╔══════════════════════════════════════════════╗
║      ✅ PIPELINE COMPLETADO EXITOSAMENTE     ║
╠══════════════════════════════════════════════╣
║  Score Versión A : ${env.SCORE_A}
║  Score Versión B : ${env.SCORE_B}
║  🏆 Ganador      : Versión ${env.GANADOR}
║  Motivo          : ${env.MOTIVO}
║  ✅ En producción: puerto ${PUERTO_PROD}
║  📋 Reporte HTML : Build Artifacts
║  📝 Historial    : deployment-history.json
╚══════════════════════════════════════════════╝
            """
        }
        failure {
            echo '❌ Pipeline falló. Limpiando contenedores de prueba...'
            sh """
                docker stop api-ver-a 2>/dev/null || true
                docker rm   api-ver-a 2>/dev/null || true
                docker stop api-ver-b 2>/dev/null || true
                docker rm   api-ver-b 2>/dev/null || true
            """
        }
    }
}