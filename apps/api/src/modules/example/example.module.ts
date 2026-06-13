import { Module } from '@nestjs/common'
import { ExampleController } from './example.controller'
import { ExampleRepository } from './example.repository'
import { ExampleService } from './example.service'

@Module({
  controllers: [ExampleController],
  providers: [ExampleService, ExampleRepository],
  exports: [ExampleService],
})
export class ExampleModule {}
