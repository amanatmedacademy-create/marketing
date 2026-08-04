import 'reflect-metadata';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, trustProxy: true }),
  );
  const config = app.get(ConfigService);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.get<string>('APP_ORIGIN', 'http://localhost:5173').split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('IMDS Marketing Analytics API')
    .setDescription('Tenant-isolated API for clients, integrations, dashboards, metrics and AAQL.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen({ port: Number(config.get('PORT', 3000)), host: '0.0.0.0' });
}

void bootstrap();
