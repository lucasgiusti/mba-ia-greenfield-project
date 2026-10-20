import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module';
import { UsersModule } from '../users/users.module';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile with TypeOrmModule.forFeature([Video]) and its Channels/Storage/Queue imports', async () => {
    const module = await Test.createTestingModule({
      // UsersModule registers User, required by the Channel#user relation.
      imports: [CoreModule, UsersModule, VideosModule],
    }).compile();

    expect(module.get(getRepositoryToken(Video))).toBeDefined();
    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    await module.close();
  }, 30000);
});
