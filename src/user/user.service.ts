import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}
  create(createUserDto: CreateUserDto) {
    this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    }).then(user => {
      if (user) {
        throw new Error('User with this email already exists');
      }
    });
    return this.prisma.user.create({
      data: createUserDto,
    });
  }


  findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  update(id: string, updateUserDto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  remove(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }


async updateResumeKey(userId: string, resumeKey: string) {
  return this.prisma.user.update({
    where: { id: userId },
    data: { resumeKey },
  });
}

async updateImageKey(userId: string, imageKey: string) {
  return this.prisma.user.update({
    where: { id: userId },
    data: { imageKey },
  });
}
}
