#!/bin/sh
# memoir DB 백업: 하루 한 번 돌리고, 최근 7일치만 남겨요. 그림도 DB 안에 있어서 함께 백업돼요.
#
# 서버에서 crontab -e 로 등록해요 (매일 새벽 3시):
#   0 3 * * * /home/ubuntu/memoir/deploy/backup.sh >> /home/ubuntu/memoir/deploy/backups/backup.log 2>&1
#
# 되살리기:
#   gunzip -c backups/memoir-2026-11-18.sql.gz | docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" memoir'
set -eu

cd "$(dirname "$0")"
mkdir -p backups
file="backups/memoir-$(date +%F).sql.gz"

# 패스워드는 MySQL 컨테이너 안의 환경 변수를 써서, 이 스크립트나 명령 기록에 남지 않아요.
docker compose exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick --routines --hex-blob memoir' \
  | gzip > "$file.tmp"
mv "$file.tmp" "$file"

find backups -name 'memoir-*.sql.gz' -mtime +7 -delete
echo "$(date '+%F %T') 백업 완료: $file ($(du -h "$file" | cut -f1))"
