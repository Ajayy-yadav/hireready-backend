
import * as bodyParser from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
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

    origin: ["http://localhost:3000"],

    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'cookie'],
  });
  // app.useGlobalPipes(new ValidationPipe());

  await app.listen(process.env.PORT!, async () => {
    console.log(`Application is running on: ${await app.getUrl()}`);
  });
}
bootstrap();
