import { describe, it, expect, vi } from 'vitest'
import { DjangoRestFrameworkExtractor } from '../djangoRestFramework'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DjangoRestFrameworkExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'django_rest_framework', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DjangoRestFrameworkExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('DjangoRestFrameworkExtractor', () => {
  describe('ModelViewSet', () => {
    it('generates full CRUD endpoints for ModelViewSet', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.viewsets import ModelViewSet

class UserViewSet(ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('UserViewSet')
      expect(surface.apiStyle).toBe('http')

      const methods = surface.endpoints.map((e) => e.httpMethod)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PUT')
      expect(methods).toContain('PATCH')
      expect(methods).toContain('DELETE')

      const operations = surface.endpoints.map((e) => e.operationName)
      expect(operations).toContain('list')
      expect(operations).toContain('retrieve')
      expect(operations).toContain('create')
      expect(operations).toContain('destroy')
    })

    it('generates only GET endpoints for ReadOnlyModelViewSet', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.viewsets import ReadOnlyModelViewSet

class ProductViewSet(ReadOnlyModelViewSet):
    queryset = Product.objects.all()
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods.every((m) => m === 'GET')).toBe(true)
      expect(methods.length).toBeGreaterThan(0)
    })
  })

  describe('@action decorator', () => {
    it('extracts @action decorated custom actions', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action

class OrderViewSet(ModelViewSet):
    queryset = Order.objects.all()

    @action(methods=["post"], detail=True, url_path="cancel")
    def cancel(self, request, pk=None):
        pass

    @action(methods=["get"], detail=False)
    def pending(self, request):
        pass
`,
      })

      const result = await extractor.extract()
      const surface = result.surfaces[0]

      const cancelAction = surface.endpoints.find((e) => e.operationName === 'cancel')
      expect(cancelAction).toBeDefined()
      expect(cancelAction?.httpMethod).toBe('POST')
      expect(cancelAction?.path).toBe('/{pk}/cancel/')

      const pendingAction = surface.endpoints.find((e) => e.operationName === 'pending')
      expect(pendingAction).toBeDefined()
      expect(pendingAction?.httpMethod).toBe('GET')
    })
  })

  describe('APIView', () => {
    it('extracts HTTP method handlers from APIView', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.views import APIView

class ItemView(APIView):
    def get(self, request):
        pass

    def post(self, request):
        pass

    def delete(self, request, pk):
        pass
`,
      })

      const result = await extractor.extract()
      const surface = result.surfaces[0]
      expect(surface.name).toBe('ItemView')

      const methods = surface.endpoints.map((e) => e.httpMethod)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('DELETE')
    })
  })

  describe('@api_view function views', () => {
    it('extracts @api_view decorated function views', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.decorators import api_view

@api_view(["GET", "POST"])
def snippet_list(request):
    pass

@api_view(["GET", "PUT", "DELETE"])
def snippet_detail(request, pk):
    pass
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(2)

      const listSurface = result.surfaces.find((s) => s.name === 'snippet_list')
      expect(listSurface?.endpoints.map((e) => e.httpMethod)).toContain('GET')
      expect(listSurface?.endpoints.map((e) => e.httpMethod)).toContain('POST')

      const detailSurface = result.surfaces.find((s) => s.name === 'snippet_detail')
      expect(detailSurface?.endpoints).toHaveLength(3)
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'views.py': `
from rest_framework.viewsets import ReadOnlyModelViewSet
from rest_framework.views import APIView

class FooViewSet(ReadOnlyModelViewSet):
    queryset = Foo.objects.all()

class BarView(APIView):
    def get(self, request): pass
    def post(self, request): pass
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBeGreaterThan(0)
    })
  })
})
