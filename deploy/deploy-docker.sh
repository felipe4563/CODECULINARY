#!/bin/bash
# Script de actualización con Docker — mismo código se clona en varias carpetas
# del VPS (cdemo, cafeteriamana, etc.), cada una con su propio .env — por eso
# se ubica solo en vez de tener una ruta fija, así no hay que editarlo por
# instancia ni se pisa entre copias al hacer `git pull`.
# Requiere: docker, docker compose plugin, y un archivo .env (ver .env.example) en la raíz del proyecto
# Uso: bash deploy/deploy-docker.sh (desde cualquier ubicación, el script resuelve su propia carpeta)

set -e
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Obteniendo cambios..."
git pull origin main

echo "==> Reconstruyendo y levantando contenedores..."
docker compose up -d --build

echo "==> Estado de los contenedores..."
docker compose ps
