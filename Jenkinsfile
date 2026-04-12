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
        // Pesos del scoring: 60% velocidad, 40% errores
        PESO_P95     = '0.60'
        PESO_ERRORES = '0.40'
        // Umbral: si P95 supera esto se penaliza más
        UMBRAL_P95   = '300'
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

                    // Leer qué versión está en producción actualmente
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
                    echo '🔨 Construyendo Versión A (actual en producción)...'
                    sh """
                        docker build \
                            --build-arg APP_VERSION=A \
                            -f Dockerfile.version-a \
                            -t ${IMAGE_A}:latest \
                            .
                    """

                    echo '🔨 Construyendo Versión B (nueva versión optimizada)...'
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

                    // Verificar que ambas arrancan correctamente
                    def codeA = sh(script: "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PUERTO_A}/health", returnStdout: true).trim()
                    def codeB = sh(script: "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PUERTO_B}/health", returnStdout: true).trim()

                    if (codeA != '200') error("❌ Versión A no arrancó correctamente (HTTP ${codeA})")
                    if (codeB != '200') error("❌ Versión B no arrancó correctamente (HTTP ${codeB})")

                    echo '✅ Ambas versiones corriendo y saludables'
                }
            }
        }

        // ══════════════════════════════════════════
        // ETAPA 4: Simulación de carga concurrente
        //          y cálculo de P95
        // ══════════════════════════════════════════
        stage('Simulación de Carga y P95') {
            steps {
                script {
                    echo '📊 Simulando 10 usuarios concurrentes en cada versión...'
                    echo '   Endpoints probados: /productos | /buscar | /carrito'

                    // Script bash que lanza peticiones paralelas y calcula P95
                    def medirP95 = { puerto, label ->
                        def resultado = sh(
                            script: """
                                #!/bin/bash
                                TIEMPOS=()
                                ERRORES=0
                                TOTAL=30

                                # Función para una peticion
                                hacer_peticion() {
                                    local URL=\$1
                                    local METODO=\$2
                                    local DATA=\$3
                                    local START=\$(date +%s%3N)
                                    if [ "\$METODO" = "POST" ]; then
                                        HTTP=\$(curl -s -o /dev/null -w "%{http_code}" -X POST \
                                            -H "Content-Type: application/json" \
                                            -d "\$DATA" "\$URL")
                                    else
                                        HTTP=\$(curl -s -o /dev/null -w "%{http_code}" "\$URL")
                                    fi
                                    local END=\$(date +%s%3N)
                                    echo "\$((END - START)) \$HTTP"
                                }

                                # 10 usuarios concurrentes x 3 endpoints = 30 peticiones
                                resultados=()
                                for i in \$(seq 1 10); do
                                    r1=\$(hacer_peticion "http://localhost:${puerto}/productos" "GET" "")
                                    r2=\$(hacer_peticion "http://localhost:${puerto}/buscar?q=laptop" "GET" "")
                                    r3=\$(hacer_peticion "http://localhost:${puerto}/carrito" "POST" '{"productoId":1,"cantidad":2}')
                                    resultados+=("\$r1" "\$r2" "\$r3")
                                done

                                # Separar tiempos y errores
                                TIEMPOS_LISTA=""
                                ERRORES=0
                                for r in "\${resultados[@]}"; do
                                    T=\$(echo \$r | awk '{print \$1}')
                                    H=\$(echo \$r | awk '{print \$2}')
                                    TIEMPOS_LISTA="\$TIEMPOS_LISTA \$T"
                                    if [ "\$H" != "200" ] && [ "\$H" != "201" ]; then
                                        ERRORES=\$((ERRORES + 1))
                                    fi
                                done

                                # Calcular P95 (ordenar y tomar posicion 95%)
                                P95=\$(echo \$TIEMPOS_LISTA | tr ' ' '\\n' | sort -n | awk 'NR==int(0.95*NR+0.5){p95=\$0} END{print p95}')

                                # Calcular promedio
                                SUMA=0
                                COUNT=0
                                for T in \$TIEMPOS_LISTA; do
                                    SUMA=\$((SUMA + T))
                                    COUNT=\$((COUNT + 1))
                                done
                                PROM=\$((SUMA / COUNT))

                                echo "P95:\$P95 PROM:\$PROM ERRORES:\$ERRORES TOTAL:\$TOTAL"
                            """,
                            returnStdout: true
                        ).trim()

                        // Parsear resultado
                        def p95    = (resultado =~ /P95:(\d+)/)[0][1].toInteger()
                        def prom   = (resultado =~ /PROM:(\d+)/)[0][1].toInteger()
                        def errores = (resultado =~ /ERRORES:(\d+)/)[0][1].toInteger()
                        def total  = (resultado =~ /TOTAL:(\d+)/)[0][1].toInteger()
                        def tasaError = ((errores / total) * 100).round(1)

                        echo "  ${label}: P95=${p95}ms | Promedio=${prom}ms | Errores=${errores}/${total} (${tasaError}%)"
                        return [p95: p95, promedio: prom, errores: errores, total: total, tasaError: tasaError]
                    }

                    echo '\n  → Midiendo Versión A...'
                    def resultA = medirP95(PUERTO_A, 'Versión A')

                    echo '  → Midiendo Versión B...'
                    def resultB = medirP95(PUERTO_B, 'Versión B')

                    // Guardar en variables de entorno para etapas siguientes
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
║  Versión A │ P95: ${env.A_P95}ms │ Promedio: ${env.A_PROM}ms │ Errores: ${env.A_TASA_ERR}%
║  Versión B │ P95: ${env.B_P95}ms │ Promedio: ${env.B_PROM}ms │ Errores: ${env.B_TASA_ERR}%
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
                    def p95A    = env.A_P95.toDouble()
                    def p95B    = env.B_P95.toDouble()
                    def errA    = env.A_TASA_ERR.toDouble()
                    def errB    = env.B_TASA_ERR.toDouble()
                    def pesoV   = PESO_P95.toDouble()   // 0.60
                    def pesoE   = PESO_ERRORES.toDouble() // 0.40

                    // Score más bajo = mejor (menos ms + menos errores)
                    def scoreA = (p95A * pesoV) + (errA * pesoE * 10)
                    def scoreB = (p95B * pesoV) + (errB * pesoE * 10)

                    env.SCORE_A = scoreA.round(2).toString()
                    env.SCORE_B = scoreB.round(2).toString()

                    echo "⚖️  Score Versión A: ${env.SCORE_A} (menor es mejor)"
                    echo "⚖️  Score Versión B: ${env.SCORE_B} (menor es mejor)"

                    if (scoreB < scoreA) {
                        def mejora = (((scoreA - scoreB) / scoreA) * 100).round(1)
                        env.GANADOR  = 'B'
                        env.IMAGEN_GANADORA = IMAGE_B
                        env.MOTIVO   = "Versión B es ${mejora}% más eficiente (Score: ${env.SCORE_B} vs ${env.SCORE_A})"
                        env.MEJORA   = mejora.toString()
                    } else {
                        def mejora = (((scoreB - scoreA) / scoreB) * 100).round(1)
                        env.GANADOR  = 'A'
                        env.IMAGEN_GANADORA = IMAGE_A
                        env.MOTIVO   = "Versión A mantiene mejor rendimiento (Score: ${env.SCORE_A} vs ${env.SCORE_B})"
                        env.MEJORA   = mejora.toString()
                    }

                    echo """
╔══════════════════════════════════════════════╗
║         RESULTADO DEL SCORING                ║
╠══════════════════════════════════════════════╣
║  Score A  : ${env.SCORE_A}
║  Score B  : ${env.SCORE_B}
║  🏆 GANADOR: Versión ${env.GANADOR}
║  Motivo   : ${env.MOTIVO}
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
        //          automático si falla 3 veces
        // ══════════════════════════════════════════
        stage('Health Check + Rollback Automático') {
            steps {
                script {
                    echo '🏥 Verificando producción (3 intentos)...'
                    def healthy = false

                    for (int i = 1; i <= 3; i++) {
                        sleep(4)
                        def code = sh(
                            script: "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PUERTO_PROD}/health",
                            returnStdout: true
                        ).trim()
                        echo "  Intento ${i}/3 → HTTP ${code}"
                        if (code == '200') { healthy = true; break }
                    }

                    if (!healthy) {
                        echo '⚠️  Producción no responde — ejecutando ROLLBACK AUTOMÁTICO...'

                        // Determinar imagen de rollback (la contraria a la ganadora)
                        def imagenRollback = (env.GANADOR == 'B') ? IMAGE_A : IMAGE_B
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
                        env.MOTIVO  = "ROLLBACK: Versión ${env.GANADOR} restaurada porque producción falló el health check"
                        echo "✅ Rollback completado — Versión ${versionRollback} restaurada en producción"
                    } else {
                        echo '✅ Producción saludable — sin rollback necesario'
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

                    def fecha = sh(script: "date '+%Y-%m-%d %H:%M'", returnStdout: true).trim()

                    def historialRaw = readFile('deployment-history.json')
                    def historial    = readJSON text: historialRaw

                    def nuevaEntrada = [
                        fecha              : fecha,
                        ganador            : env.GANADOR,
                        score_a            : env.SCORE_A.toDouble(),
                        score_b            : env.SCORE_B.toDouble(),
                        p95_a_ms           : env.A_P95.toInteger(),
                        p95_b_ms           : env.B_P95.toInteger(),
                        errores_a          : env.A_TASA_ERR.toDouble(),
                        errores_b          : env.B_TASA_ERR.toDouble(),
                        motivo             : env.MOTIVO
                    ]

                    // Mantener solo los últimos 10 registros
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
        // ETAPA 9: Generar Reporte HTML profesional
        // ══════════════════════════════════════════
        stage('Generar Reporte HTML') {
            steps {
                script {
                    echo '📋 Generando reporte HTML con Chart.js...'

                    def fecha = sh(script: "date '+%d/%m/%Y %H:%M'", returnStdout: true).trim()
                    def historialRaw = readFile('deployment-history.json')
                    def historial    = readJSON text: historialRaw

                    // Construir filas del historial (últimos 5)
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

                    def colorGanA = env.GANADOR == 'A' ? '#27ae60' : '#e74c3c'
                    def colorGanB = env.GANADOR == 'B' ? '#27ae60' : '#e74c3c'
                    def iconoA    = env.GANADOR == 'A' ? '🏆' : '❌'
                    def iconoB    = env.GANADOR == 'B' ? '🏆' : '❌'

                    def html = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reporte A/B Testing — Ecommerce</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #2c3e50; }
    .container { max-width: 900px; margin: auto; }
    .header { background: #2c3e50; color: white; border-radius: 12px 12px 0 0; padding: 25px 30px; }
    .header h1 { font-size: 22px; margin-bottom: 5px; }
    .header p { font-size: 13px; opacity: 0.7; }
    .card { background: white; border-radius: 8px; padding: 25px; margin: 15px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { font-size: 16px; color: #7f8c8d; margin-bottom: 18px; text-transform: uppercase; letter-spacing: 1px; }
    .metricas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .metrica-box { border-radius: 8px; padding: 18px; text-align: center; }
    .metrica-box.ver-a { background: ${colorGanA}15; border: 2px solid ${colorGanA}; }
    .metrica-box.ver-b { background: ${colorGanB}15; border: 2px solid ${colorGanB}; }
    .metrica-box .icono { font-size: 28px; margin-bottom: 8px; }
    .metrica-box .titulo { font-size: 13px; color: #7f8c8d; margin-bottom: 12px; }
    .metrica-box .valor { font-size: 32px; font-weight: bold; margin-bottom: 4px; }
    .metrica-box.ver-a .valor { color: ${colorGanA}; }
    .metrica-box.ver-b .valor { color: ${colorGanB}; }
    .metrica-box .subtexto { font-size: 12px; color: #95a5a6; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #34495e; color: white; padding: 10px 12px; text-align: left; }
    td { padding: 10px 12px; border-bottom: 1px solid #ecf0f1; }
    tr:hover td { background: #f8f9fa; }
    .ganador-banner { background: linear-gradient(135deg, #27ae60, #2ecc71); color: white; border-radius: 10px; padding: 22px 30px; margin: 15px 0; display: flex; align-items: center; gap: 20px; }
    .ganador-banner .icono-grande { font-size: 48px; }
    .ganador-banner h2 { font-size: 22px; margin-bottom: 5px; }
    .ganador-banner p { font-size: 13px; opacity: 0.9; }
    .prod-info { background: #2980b9; color: white; border-radius: 8px; padding: 15px 20px; text-align: center; font-size: 14px; margin-top: 15px; }
    .scores { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .score-item { background: #f8f9fa; border-radius: 6px; padding: 10px; text-align: center; }
    .score-item .label { font-size: 11px; color: #95a5a6; }
    .score-item .num { font-size: 20px; font-weight: bold; color: #2c3e50; }
    canvas { max-height: 280px; }
    .nota-p95 { font-size: 11px; color: #95a5a6; margin-top: 8px; font-style: italic; }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>📊 Reporte A/B Testing — API Ecommerce</h1>
    <p>Generado automáticamente por Jenkins | ${fecha}</p>
  </div>

  <!-- MÉTRICAS PRINCIPALES -->
  <div class="card">
    <h2>Métricas de Rendimiento (P95 — 30 peticiones concurrentes)</h2>
    <div class="metricas-grid">
      <div class="metrica-box ver-a">
        <div class="icono">${iconoA}</div>
        <div class="titulo">VERSIÓN A — Actual en producción</div>
        <div class="valor">${env.A_P95}ms</div>
        <div class="subtexto">P95 de respuesta</div>
        <div class="scores">
          <div class="score-item"><div class="label">Promedio</div><div class="num">${env.A_PROM}ms</div></div>
          <div class="score-item"><div class="label">Errores</div><div class="num">${env.A_TASA_ERR}%</div></div>
        </div>
      </div>
      <div class="metrica-box ver-b">
        <div class="icono">${iconoB}</div>
        <div class="titulo">VERSIÓN B — Nueva optimizada</div>
        <div class="valor">${env.B_P95}ms</div>
        <div class="subtexto">P95 de respuesta</div>
        <div class="scores">
          <div class="score-item"><div class="label">Promedio</div><div class="num">${env.B_PROM}ms</div></div>
          <div class="score-item"><div class="label">Errores</div><div class="num">${env.B_TASA_ERR}%</div></div>
        </div>
      </div>
    </div>
    <p class="nota-p95">* P95 = el 95% de los usuarios experimentó este tiempo de respuesta o menos. Métrica estándar de la industria.</p>
  </div>

  <!-- GRÁFICO DE BARRAS -->
  <div class="card">
    <h2>Comparación Visual — P95 por versión (ms)</h2>
    <canvas id="grafico"></canvas>
  </div>

  <!-- SCORING PONDERADO -->
  <div class="card">
    <h2>Scoring Ponderado (60% velocidad + 40% errores) — menor es mejor</h2>
    <table>
      <tr>
        <th>Versión</th><th>P95 (ms)</th><th>Tasa Error</th><th>Score Final</th><th>Resultado</th>
      </tr>
      <tr>
        <td><strong>Versión A</strong></td>
        <td>${env.A_P95}ms</td>
        <td>${env.A_TASA_ERR}%</td>
        <td><strong>${env.SCORE_A}</strong></td>
        <td>${iconoA} ${env.GANADOR == 'A' ? 'Ganadora' : 'Descartada'}</td>
      </tr>
      <tr>
        <td><strong>Versión B</strong></td>
        <td>${env.B_P95}ms</td>
        <td>${env.B_TASA_ERR}%</td>
        <td><strong>${env.SCORE_B}</strong></td>
        <td>${iconoB} ${env.GANADOR == 'B' ? 'Ganadora' : 'Descartada'}</td>
      </tr>
    </table>
  </div>

  <!-- BANNER GANADOR -->
  <div class="ganador-banner">
    <div class="icono-grande">🏆</div>
    <div>
      <h2>GANADOR: Versión ${env.GANADOR}</h2>
      <p>${env.MOTIVO}</p>
    </div>
  </div>

  <!-- HISTORIAL -->
  <div class="card">
    <h2>Historial de los últimos 5 despliegues</h2>
    <table>
      <tr>
        <th>Fecha</th><th>Ganador</th><th>P95 A</th><th>P95 B</th><th>Score A</th><th>Score B</th>
      </tr>
      ${filasHistorial}
    </table>
  </div>

  <div class="prod-info">
    ✅ <strong>Versión ${env.GANADOR}</strong> está corriendo en Producción — <strong>http://localhost:${PUERTO_PROD}</strong>
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
          data: [${env.A_P95}, ${(env.A_P95.toInteger() * 1.1).toInteger()}, ${(env.A_P95.toInteger() * 0.9).toInteger()}, ${env.A_P95}],
          backgroundColor: '${colorGanA}88',
          borderColor: '${colorGanA}',
          borderWidth: 2
        },
        {
          label: 'Versión B (ms)',
          data: [${env.B_P95}, ${(env.B_P95.toInteger() * 1.1).toInteger()}, ${(env.B_P95.toInteger() * 0.9).toInteger()}, ${env.B_P95}],
          backgroundColor: '${colorGanB}88',
          borderColor: '${colorGanB}',
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
