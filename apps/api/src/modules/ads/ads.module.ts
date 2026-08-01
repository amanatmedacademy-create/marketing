import { Module } from '@nestjs/common';
import { AdsTokenCryptoService } from './ads-token-crypto.service.js';
import { MetaAdsController } from './meta-ads.controller.js';
import { MetaAdsService } from './meta-ads.service.js';

@Module({
  controllers: [MetaAdsController],
  providers: [MetaAdsService, AdsTokenCryptoService],
})
export class AdsModule {}
