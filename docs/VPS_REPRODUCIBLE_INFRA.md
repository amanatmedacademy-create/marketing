# IMDS Marketing — reproducible VPS

Репозиторий содержит инфраструктуру для развёртывания IMDS Marketing на чистом Ubuntu VPS и восстановления после потери сервера.

## Что воспроизводится

- Docker Engine + Compose
- PostgreSQL 16 в контейнере `imds-postgres`
- PostgREST в контейнере `imds-postgrest` на `127.0.0.1:3000`
- Node.js 22
- Nginx
- UFW
- системный пользователь `imds`
- `/opt/imds-marketing/releases` и `current`
- `/etc/imds-marketing.env`
- локальный service-role JWT для PostgREST
- systemd runtime Marketing
- ежедневные локальные PostgreSQL backups
- GitHub Actions backup artifact с AES-256-CBC шифрованием
- disaster recovery на новый VPS

## GitHub Secrets

Обязательные:

- `VPS_HOST`
- `VPS_USER`
- `VPS_PASSWORD`
- `BACKUP_ENCRYPTION_KEY` — длинная случайная фраза/ключ, хранить только в GitHub Secrets

Остальные application/OAuth secrets остаются в существующей схеме проекта.

## Provision VPS

Workflow: `.github/workflows/provision-vps.yml`

Запускается только вручную через `workflow_dispatch`.

Inputs:

- `app_origin` — публичный origin, например `http://89.207.250.55`
- `ssh_port` — SSH-порт нового VPS. Для стандартного чистого Ubuntu обычно `22`; для текущей IMDS-схемы можно указать `24`.

Workflow выполняет:

1. typecheck/build;
2. создаёт release archive;
3. загружает его на VPS;
4. запускает `infra/bootstrap-server.sh`;
5. поднимает PostgreSQL/PostgREST;
6. запускает существующий `deploy/vps/install-release.sh`;
7. выполняет `infra/health-check.sh`;
8. проверяет публичные `/api/health` и `/integrations`.

Для полностью пустой базы production-восстановление предпочтительно выполнять через Disaster Recovery с реальным database backup, потому что это гарантирует идентичность данных и схемы рабочему серверу.

## Backup VPS Database

Workflow: `.github/workflows/backup-vps.yml`

- запускается ежедневно и вручную;
- делает `pg_dump --format=custom`;
- проверяет SHA-256;
- шифрует dump через AES-256-CBC/PBKDF2;
- загружает только зашифрованный файл как GitHub Actions artifact;
- retention artifact: 30 дней.

На самом VPS `imds-marketing-backup.timer` также создаёт ежедневные локальные backup-файлы в `/var/backups/imds-marketing` с retention 14 дней.

## Disaster Recovery VPS

Workflow: `.github/workflows/disaster-recovery.yml`

Inputs:

- `app_origin` — origin replacement VPS;
- `backup_run_id` — run ID успешного `Backup VPS Database`;
- `ssh_port` — SSH-порт replacement VPS.

Recovery flow:

1. скачивает зашифрованный backup artifact выбранного run;
2. проверяет SHA-256;
3. расшифровывает dump через `BACKUP_ENCRYPTION_KEY`;
4. собирает текущий `main`;
5. загружает release + dump на новый VPS;
6. создаёт Docker/PostgreSQL/PostgREST/Node/Nginx;
7. восстанавливает PostgreSQL;
8. устанавливает текущий release;
9. проверяет инфраструктуру и публичный API.

## Серверные файлы

- `infra/docker-compose.yml`
- `infra/bootstrap-server.sh`
- `infra/health-check.sh`
- `infra/backup/backup.sh`
- `infra/backup/restore.sh`
- `infra/systemd/imds-marketing-backup.service`
- `infra/systemd/imds-marketing-backup.timer`

## Ограничение

Этот контур создаёт и настраивает ОС **внутри уже созданного VPS**. Создание самой виртуальной машины у хостинг-провайдера потребует отдельного provider API/Terraform-модуля и API token конкретного провайдера.
