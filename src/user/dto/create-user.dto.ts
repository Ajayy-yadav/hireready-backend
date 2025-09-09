import { IsString, IsEmail } from 'class-validator';

export class CreateUserDto {
    @IsString()
    id: string;
    
    @IsString()
    username: string;
    
    @IsEmail()
    email: string;
    
    @IsString()
    currentRole: string;
}
