import { Controller, Get } from '@nestjs/common';
import { Protegido } from '../auth/permissoes';
import { CostsService } from './costs.service';

@Protegido('custos_ia')
@Controller('custos')
export class CostsController {
  constructor(private readonly costsService: CostsService) {}

  @Get()
  summary() {
    return this.costsService.summary();
  }
}
