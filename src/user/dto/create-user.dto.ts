import { IsString, IsEmail, IsUUID } from 'class-validator';

export class CreateUserDto {
    @IsUUID()
    id: string;
    
    @IsString()
    username: string;
    
    @IsEmail()
    email: string;
    
    @IsString()
    currentRole: string;
}
