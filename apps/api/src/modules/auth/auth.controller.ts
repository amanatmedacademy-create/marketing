import { Body, Controller, Get, Headers, Ip, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { JwtPayload } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const REFRESH_COOKIE = 'imds_refresh';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.register(dto, { ip, userAgent });
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(dto, { ip, userAgent });
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('refresh')
  async refresh(
    @Req() request: FastifyRequest,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(token, { ip, userAgent });
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() request: FastifyRequest & { user: JwtPayload }, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(request.user.sessionId);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: FastifyRequest & { user: JwtPayload }) {
    return this.auth.me(request.user);
  }

  private setRefreshCookie(reply: FastifyReply, token: string) {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60,
    });
  }
}
