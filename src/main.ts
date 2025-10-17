
import * as bodyParser from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('HireReady API')
    .setDescription('API documentation for HireReady application')
    .setVersion('1.0')
    .build();
const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
  app.enableCors({
    // Allow frontend (Next.js on port 3000)
    origin: ["http://localhost:3000", "http://localhost:3001", "https://www.hireready.live" , "https://hireready.live"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'cookie'],
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0', async () => {
    console.log(`Application is running on port: ${port}`);
  });
}
bootstrap();
