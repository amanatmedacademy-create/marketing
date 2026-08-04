import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'analytics', name: 'agencies' })
export class AgencyEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ default: 'Asia/Almaty' }) timezone!: string;
  @Column({ default: 'ru' }) language!: string;
  @Column({ default: 'trial' }) plan!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}

@Entity({ schema: 'analytics', name: 'users' })
@Index(['agencyId', 'externalAuthId'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'agency_id', type: 'uuid' }) agencyId!: string;
  @Column({ name: 'external_auth_id' }) externalAuthId!: string;
  @Column() email!: string;
  @Column() name!: string;
  @Column({ default: 'staff' }) role!: string;
  @Column({ default: 'active' }) status!: string;
}

@Entity({ schema: 'analytics', name: 'clients' })
@Index(['agencyId', 'status'])
export class ClientEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'agency_id', type: 'uuid' }) agencyId!: string;
  @Column() company!: string;
  @Column({ nullable: true }) url!: string | null;
  @Column({ default: 'Asia/Almaty' }) timezone!: string;
  @Column({ default: 'KZ' }) country!: string;
  @Column({ default: 'ru' }) language!: string;
  @Column({ default: 'active' }) status!: string;
  @Column({ name: 'brand_color', default: '#0072EE' }) brandColor!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}

@Entity({ schema: 'analytics', name: 'integrations' })
export class IntegrationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) slug!: string;
  @Column() name!: string;
  @Column() category!: string;
  @Column({ name: 'auth_type' }) authType!: string;
  @Column({ name: 'is_beta', default: false }) isBeta!: boolean;
}

@Entity({ schema: 'analytics', name: 'data_sources' })
@Index(['agencyId', 'clientId', 'status'])
export class DataSourceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'agency_id', type: 'uuid' }) agencyId!: string;
  @Column({ name: 'client_id', type: 'uuid' }) clientId!: string;
  @Column({ name: 'integration_id', type: 'uuid' }) integrationId!: string;
  @Column() label!: string;
  @Column({ name: 'external_identifier', nullable: true }) externalIdentifier!: string | null;
  @Column({ default: 'connected' }) status!: string;
  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true }) lastSyncAt!: Date | null;
  @Column({ name: 'sync_error', type: 'text', nullable: true }) syncError!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
