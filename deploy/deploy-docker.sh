#!/bin/bash
# Despliegue con Docker usando las imágenes que construye GitHub Actions
# (.github/workflows/imagenes.yml) y publica en ghcr.io: el VPS NO construye
# nada, solo descarga la imagen del commit actual y levanta los contenedores.
#
# El mismo código se clona en varias carpetas del VPS (cdemo, roxo, ...),
# cada una con su propio .env (dominio, puerto, secretos) — por eso el script
# se ubica solo en vez de tener una ruta fija.
#
# Requiere: docker, docker compose plugin y un .env (ver .env.example) en la
# raíz del proyecto.
# Uso: bash deploy/deploy-docker.sh
#
# Volver a una versión anterior:  TAG=<sha del commit> docker compose up -d --no-build

set -euo pipefail

# Todo vive dentro de main() y se llama en la última línea: bash termina de
# leer el archivo antes de ejecutar, así que el `git pull` puede reescribir
# este mismo script sin romper la ejecución en curso.
main() {
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  local SERVICIOS=(backend frontend)
  local ORIGEN_IMAGENES="https://github.com/felipe4563/CODECULINARY"
  local ESPERA_SEG=30
  local MAX_INTENTOS=30 # 30 x 30 s = 15 min

  if [ ! -f .env ]; then
    echo "ERROR: falta el archivo .env en $(pwd) (ver .env.example)."
    exit 1
  fi

  echo "==> Verificando cambios locales..."
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "ERROR: hay cambios sin commitear en el VPS:"
    git status --short --untracked-files=no
    echo "Guardalos o descartalos antes de desplegar."
    exit 1
  fi

  local PREVIO
  PREVIO="$(git rev-parse HEAD)"

  echo "==> Obteniendo cambios..."
  git pull --ff-only origin main

  TAG="$(git rev-parse HEAD)"
  export TAG
  echo "==> Versión a desplegar: ${TAG}"

  echo "==> Descargando imágenes de ghcr.io..."
  local intento=1
  until docker compose pull --quiet "${SERVICIOS[@]}"; do
    if [ "$intento" -ge "$MAX_INTENTOS" ]; then
      echo ""
      echo "ERROR: las imágenes de ${TAG} no aparecieron en ghcr.io después de 15 minutos."
      echo "Revisá GitHub → Actions. Producción sigue con la versión anterior (no se tocó nada)."
      exit 1
    fi
    echo "    Todavía no están (GitHub Actions puede seguir construyendo). Reintento ${intento}/${MAX_INTENTOS} en ${ESPERA_SEG} s..."
    sleep "$ESPERA_SEG"
    intento=$((intento + 1))
  done

  echo "==> Levantando contenedores..."
  docker compose up -d --no-build --remove-orphans

  # Las migraciones NO corren solas: avisar si este pull trajo alguna nueva.
  local NUEVAS
  NUEVAS="$(git diff --name-only --diff-filter=A "$PREVIO" HEAD -- backend/database/migrations || true)"
  if [ -n "$NUEVAS" ]; then
    echo ""
    echo "ATENCIÓN: este despliegue trajo migraciones nuevas que hay que aplicar a mano:"
    echo "$NUEVAS" | sed 's/^/    /'
    echo "  Respaldá la base primero y aplicá cada una, por ejemplo:"
    echo "    docker compose exec -T db sh -c 'mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \"\$MYSQL_DATABASE\"' < backend/database/migrations/<archivo>.sql"
    # La imagen no trae database/ (.dockerignore): se monta la carpeta del repo.
    echo "  Justo después de la 053 (catálogo por sucursal) corré una sola vez el script de datos"
    echo "  (node database/scripts/migrar-catalogo-por-sucursal.js), por ejemplo:"
    echo "    TAG=${TAG} docker compose run --rm --no-deps -v \"\$PWD/backend/database/scripts:/app/database/scripts:ro\" backend node database/scripts/migrar-catalogo-por-sucursal.js"
  fi

  echo "==> Limpiando imágenes viejas de este proyecto..."
  # Solo imágenes de ESTE repo (por su etiqueta de origen) que ningún
  # contenedor usa: no toca las de otros sistemas del VPS ni las que otra
  # instancia de este mismo repo tenga corriendo con otro TAG.
  docker image prune -a -f --filter "label=org.opencontainers.image.source=${ORIGEN_IMAGENES}" >/dev/null || true

  echo "==> Estado de los contenedores..."
  docker compose ps

  echo ""
  echo "Despliegue completado (${TAG})"
}

main "$@"
