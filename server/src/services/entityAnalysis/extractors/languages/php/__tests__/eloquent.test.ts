import { describe, it, expect, vi } from 'vitest'
import { EloquentExtractor } from '../eloquent'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): EloquentExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'eloquent', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new EloquentExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    if (pattern.includes('migrations')) return Object.keys(files).filter((f) => f.includes('migrations'))
    if (pattern.includes('Models')) return Object.keys(files).filter((f) => f.includes('Models'))
    return []
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('EloquentExtractor', () => {
  it('extracts tables from Laravel migrations', async () => {
    const extractor = makeExtractor({
      'database/migrations/2024_01_01_create_users_table.php': `<?php
use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;

class CreateUsersTable extends Migration
{
    public function up()
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->string('name')->nullable();
            $table->boolean('is_admin')->default(false);
            $table->timestamps();
        });
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    const users = result.entities[0]
    expect(users.name).toBe('users')

    const id = users.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)

    const email = users.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
    expect(email!.isUnique).toBe(true)

    const name = users.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)
  })

  it('extracts associations from Eloquent model files', async () => {
    const extractor = makeExtractor({
      'database/migrations/2024_01_01_create_posts_table.php': `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->unsignedBigInteger('user_id');
});
`,
      'app/Models/Post.php': `<?php
namespace App\\Models;
use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
    public function user()
    {
        return $this->belongsTo(User::class);
    }
    public function comments()
    {
        return $this->hasMany(Comment::class);
    }
}
`,
    })

    const result = await extractor.extract()
    const post = result.entities.find((e) => e.name === 'posts')
    expect(post).toBeDefined()

    const belongsTo = post!.relationships.find((r) => r.type === 'many_to_one')
    expect(belongsTo?.targetEntity).toBe('User')

    const hasMany = post!.relationships.find((r) => r.type === 'one_to_many')
    expect(hasMany?.targetEntity).toBe('Comment')
  })
})
