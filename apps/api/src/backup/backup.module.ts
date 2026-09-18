import { Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createGzip } from 'zlib';

/**
 * Backup automático do banco, feito pela própria API — antes dependia de alguém
 * rodar scripts/backup-banco.ps1 na mão (e o último era anterior à reimportação).
 *
 * - A cada 12 h (e ao subir, se o último tiver mais de 12 h): pg_dump do container
 *   compactado em backups/atendimento-AAAA-MM-DD_HHMM.sql.gz (~1/6 do tamanho).
 * - Nenhum backup é apagado: a pasta fica no OneDrive e a regra da operação é não
 *   apagar nada de lá. Compactado, um mês ocupa cerca de 200 MB.
 * - Restaurar: gunzip -c backups/<arquivo>.sql.gz | docker exec -i <container> psql -U atendimento -d atendimento
 *
 * O backup contém dados pessoais: a pasta backups/ não vai para o git.
 */
const INTERVALO_MS = 12 * 3600e3;
const CONTAINER = process.env.BACKUP_CONTAINER || 'projetowhatsapppr7-postgres-1';
// dist/src/backup → raiz do projeto (5 níveis acima)
const PASTA = process.env.BACKUP_PASTA || join(__dirname, '..', '..', '..', '..', '..', 'backups');

@Injectable()
export class BackupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Backup');
  private timer?: NodeJS.Timeout;
  private rodando = false;

  onApplicationBootstrap() {
    if (process.env.BACKUP_AUTOMATICO === 'off') return;
    // Espera a API terminar de subir para não disputar o banco na largada
    setTimeout(() => this.seNecessario(), 60_000);
    this.timer = setInterval(() => this.seNecessario(), 30 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Último backup (manual .sql ou automático .sql.gz). */
  ultimo(): { arquivo: string; em: Date } | null {
    if (!existsSync(PASTA)) return null;
    const arquivos = readdirSync(PASTA).filter((f) => /^atendimento-.*\.sql(\.gz)?$/.test(f));
    const maisNovo = arquivos.map((f) => ({ arquivo: f, em: statSync(join(PASTA, f)).mtime })).sort((a, b) => +b.em - +a.em)[0];
    return maisNovo ?? null;
  }

  private async seNecessario() {
    const u = this.ultimo();
    if (u && Date.now() - +u.em < INTERVALO_MS) return;
    await this.fazer().catch((err) => this.logger.error(`Backup falhou: ${(err as Error).message}`));
  }

  fazer(): Promise<string> {
    if (this.rodando) return Promise.reject(new Error('já existe um backup em andamento'));
    this.rodando = true;
    mkdirSync(PASTA, { recursive: true });
    const agora = new Date(Date.now() - 3 * 3600e3).toISOString(); // nome no horário de Brasília
    const nome = `atendimento-${agora.slice(0, 10)}_${agora.slice(11, 13)}${agora.slice(14, 16)}.sql.gz`;
    const destino = join(PASTA, nome);
    return new Promise<string>((ok, falha) => {
      // No computador local o banco roda em container (docker exec); no servidor a API
      // já está junto do banco e chama o pg_dump direto com a DATABASE_URL (BACKUP_DIRETO=true)
      const direto = process.env.BACKUP_DIRETO === 'true';
      const dump = direto
        ? spawn('pg_dump', [String(process.env.DATABASE_URL).replace(/\?.*$/, ''), '--clean', '--if-exists'], { windowsHide: true })
        : spawn('docker', ['exec', CONTAINER, 'pg_dump', '-U', 'atendimento', '-d', 'atendimento', '--clean', '--if-exists'], { windowsHide: true });
      const saida = createWriteStream(destino);
      let erro = '';
      dump.stderr.on('data', (d) => (erro += String(d)));
      dump.stdout.pipe(createGzip()).pipe(saida);
      dump.on('error', (e) => { this.rodando = false; falha(e); });
      dump.on('close', (codigo) => {
        saida.on('close', () => {
          this.rodando = false;
          const tamanho = existsSync(destino) ? statSync(destino).size : 0;
          // Arquivo vazio/pequeno = dump falhou: não deixa um backup falso na pasta
          if (codigo !== 0 || tamanho < 10_000) {
            try { unlinkSync(destino); } catch { /* nada a remover */ }
            return falha(new Error(`pg_dump saiu com código ${codigo}${erro ? ': ' + erro.slice(0, 200) : ''}`));
          }
          this.logger.log(`Backup salvo: ${nome} (${(tamanho / 1048576).toFixed(1)} MB)`);
          ok(nome);
        });
      });
    });
  }
}

@Module({ providers: [BackupService], exports: [BackupService] })
export class BackupModule {}
