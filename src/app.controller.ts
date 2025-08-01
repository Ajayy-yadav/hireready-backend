import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller("/api/v1")
export class AppController {
  constructor() {}
  @Get("/healthy")
  health(@Res() res) {
    return res.status(200).json({
      status: "ok",
      message: "Server is healthy"
    });
  }
}