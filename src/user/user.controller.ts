import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiBody } from '@nestjs/swagger';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("create")
  @ApiBody({
    type: CreateUserDto,
    description: 'Create a new user',
    examples: {
      example1: {
        summary: 'Sample user',
        value: {
            id: '12345',
          username: 'john_doe',
          email: 'john@example.com',
          currentRole: 'Developer',
        },
      }
    },
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }


  @Get("get/:id")
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch("update/:id")
  @ApiBody({
    type: UpdateUserDto,
    description: 'Update user details',
    examples: {
      example1: {
        summary: 'Sample user',
        value: {
          username: 'john_doe',
          email: 'john@example.com',
          currentRole: 'Developer',
          resumeUrl: 'https://example.com/resume.pdf',
          imageUrl: 'https://example.com/image.jpg',
        },
      }
    },
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete("delete/:id")
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
