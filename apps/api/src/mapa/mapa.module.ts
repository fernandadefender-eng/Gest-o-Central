import { Controller, Get, Module, Query } from '@nestjs/common';
import { Protegido } from '../auth/permissoes';
import { MapaService } from './mapa.service';

// Mapa operacional: quem tem a visão geral OU só o mapa (Help Desk, monitoramento)
@Protegido('visao_geral', 'mapa')
@Controller('mapa')
class MapaController {
  constructor(private readonly mapaService: MapaService) {}

  @Get('estados')
  porEstado(@Query('categoria') categoria?: string) {
    return this.mapaService.porEstado(categoria);
  }

  /** Mapa de alerta: onde estão acontecendo roubos e furtos de veículo */
  @Get('incidencia-veicular')
  incidenciaVeicular(@Query('meses') meses?: string) {
    return this.mapaService.incidenciaVeicular(Number(meses) || 12);
  }

  /** Domínio de facção por estado (fonte pública) */
  @Get('areas-risco')
  areasRisco(@Query('uf') uf?: string, @Query('faccao') faccao?: string) {
    return this.mapaService.areasDeRisco(uf, faccao);
  }

  /** Tiroteios e roubos de veículo de fonte pública, georreferenciados */
  @Get('ocorrencias-publicas')
  ocorrenciasPublicas(@Query('uf') uf?: string, @Query('dias') dias?: string, @Query('tipo') tipo?: string) {
    return this.mapaService.ocorrenciasPublicas(uf, Number(dias) || 180, tipo);
  }

  /** Delegacias, batalhões e postos policiais por estado */
  @Get('policia')
  policia(@Query('uf') uf?: string, @Query('tipo') tipo?: string) {
    return this.mapaService.unidadesPoliciais(uf, tipo);
  }

  @Get('categorias')
  categorias() {
    return this.mapaService.categorias();
  }
}

@Module({
  controllers: [MapaController],
  providers: [MapaService],
})
export class MapaModule {}
