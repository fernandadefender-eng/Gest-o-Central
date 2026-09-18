/**
 * Backup imediato do banco (mesmo formato do automático da API).
 *   npx ts-node -T scripts/backup-agora.ts
 */
import { join } from 'path';
process.env.BACKUP_PASTA = process.env.BACKUP_PASTA || join(__dirname, '..', '..', '..', 'backups');
import { BackupService } from '../src/backup/backup.module';

new BackupService().fazer().then((nome) => console.log('backup salvo:', nome)).catch((e) => { console.error('falhou:', e.message); process.exit(1); });
