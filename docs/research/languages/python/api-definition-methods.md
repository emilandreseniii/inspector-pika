# Python API Definition Methods

This document is a detailed inventory of how APIs are defined in Python projects. It covers REST/HTTP, GraphQL, and RPC patterns detected by Inspector Pika's API analysis feature.

---

## REST / HTTP

### Flask

**Dependency signals:**
- `requirements*.txt`, `Pipfile`, `pyproject.toml`: `Flask`, `flask`
- May also appear as `flask[async]`, `Flask-RESTful`, `Flask-RESTX`, `flask-smorest`

**Core pattern — `app.route` decorator:**
```python
app = Flask(__name__)

@app.route('/users', methods=['GET', 'POST'])   # multiple methods
@app.route('/users/<int:user_id>', methods=['GET', 'DELETE'])
def user_detail(user_id):
    ...
```
- First arg to `@app.route` is the path
- `methods` kwarg lists HTTP methods (default: `['GET']` if omitted)
- Path parameters use `<type:name>` syntax: `<int:id>`, `<string:name>`, `<uuid:token>`, `<path:subpath>`

**Blueprint pattern (most common in real apps):**
```python
# auth/routes.py
auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

@auth_bp.route('/login', methods=['POST'])
def login(): ...

@auth_bp.route('/logout', methods=['POST'])
def logout(): ...
```

```python
# app.py
app.register_blueprint(auth_bp, url_prefix='/api/v1')
# Results in: POST /api/v1/auth/login, POST /api/v1/auth/logout
```

Prefix resolution requires matching the blueprint variable name to its `register_blueprint` call. This may span multiple files. When resolved: concatenate `register_blueprint(prefix)` + Blueprint `url_prefix` + route path. When not resolved: emit the local path with a warning.

**Flask-RESTful / Flask-RESTX:**
```python
from flask_restful import Resource, Api

api = Api(app, prefix='/api/v1')

class UserList(Resource):
    def get(self):   ...   # → GET /api/v1/users
    def post(self):  ...   # → POST /api/v1/users

class UserDetail(Resource):
    def get(self, user_id):    ...   # → GET /api/v1/users/<user_id>
    def put(self, user_id):    ...
    def delete(self, user_id): ...

api.add_resource(UserList, '/users')
api.add_resource(UserDetail, '/users/<int:user_id>')
```

Extract: find `api.add_resource(ClassName, '/path')` mappings. For each registered class, extract HTTP methods from the `get()`, `post()`, `put()`, `delete()`, `patch()` method definitions.

**Flask-smorest / flask-openapi3:**
These extensions layer OpenAPI generation on top of Flask. If a generated spec file is present, prefer it. Otherwise, extract from route decorators as normal Flask.

**Path parameter extraction:**
Flask `<type:name>` → normalize to `{name}` in the stored path:
- `<int:user_id>` → `{user_id}` (type: `int`)
- `<string:name>` → `{name}` (type: `string`)
- `<uuid:token>` → `{token}` (type: `uuid`)
- `<path:subpath>` → `{subpath}` (type: `path`)

---

### FastAPI

**Dependency signals:**
- `fastapi`, `uvicorn`, `uvicorn[standard]`
- Often combined: `fastapi[all]`

**Core pattern:**
```python
from fastapi import FastAPI, APIRouter

app = FastAPI()

@app.get('/users')
async def list_users(skip: int = 0, limit: int = 100):
    ...

@app.post('/users', response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate):  # body via Pydantic model
    ...

@app.get('/users/{user_id}')
async def get_user(user_id: int):   # path param from {name} in path
    ...
```

**HTTP decorators:** `@app.get`, `@app.post`, `@app.put`, `@app.delete`, `@app.patch`, `@app.head`, `@app.options`

**Router pattern (most common in larger apps):**
```python
# routers/users.py
router = APIRouter(prefix='/users', tags=['users'])

@router.get('/{user_id}', response_model=UserResponse)
async def get_user(user_id: int): ...

@router.post('/', response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate): ...
```

```python
# main.py
app.include_router(router, prefix='/api/v1')
# → GET /api/v1/users/{user_id}
# → POST /api/v1/users/
```

Prefix resolution: track `APIRouter(prefix=...)` and `app.include_router(router, prefix=...)`. When the `include_router` call is in a different file, grep for it.

**Response model extraction:**
`@router.get('/path', response_model=UserResponse)` → `returnType: "UserResponse"`

**Parameter extraction from function signature:**
FastAPI uses function parameter types to distinguish:
- Path parameters: names matching `{param}` in the path string
- Query parameters: simple typed params not in path (e.g., `skip: int = 0`, `filter: str = Query(None)`)
- Body parameters: Pydantic model typed params (e.g., `user: UserCreate`)
- Dependency parameters: `db: Session = Depends(get_db)` — skip these

```python
@router.get('/users/{user_id}')
async def get_user(
    user_id: int,                     # path param (matches {user_id} in path)
    include_inactive: bool = False,   # query param
    db: Session = Depends(get_db),    # dependency — skip
):
```

**OpenAPI auto-generation:**
FastAPI generates OpenAPI at `/openapi.json` by default. If the project has exported a static `openapi.json` or `openapi.yaml` to `docs/` or the repo root, prefer it as the extraction source.

---

### Django Views (bare Django, no DRF)

**Dependency signals:**
- `Django`, `django`

**URL patterns (extracted from `urls.py`):**
```python
# urls.py
from django.urls import path, re_path, include

urlpatterns = [
    path('users/', views.user_list, name='user-list'),
    path('users/<int:pk>/', views.UserDetailView.as_view(), name='user-detail'),
    re_path(r'^users/(?P<slug>[\w-]+)/$', views.user_by_slug),
    path('api/', include('myapp.api_urls')),     # nested include
]
```

Extract: for each `path(...)` or `re_path(...)`:
- First arg is the path pattern
- Second arg is the view function or class `.as_view()`
- For function-based views: all methods defined (`def get`, `def post`, etc.) or assume GET/POST from usage
- For class-based views: find the view class and extract `get()`, `post()`, `put()`, `patch()`, `delete()` methods
- For `include(...)`: follow the import to the included URL conf

**Class-based views:**
```python
class UserListView(View):
    def get(self, request):   ...   # → GET /users/
    def post(self, request):  ...   # → POST /users/

class UserDetailView(View):
    def get(self, request, pk):    ...   # → GET /users/<pk>/
    def delete(self, request, pk): ...   # → DELETE /users/<pk>/
```

**`include()` resolution:**
Nested URL confs are common in Django. The extractor should follow `include('app.urls')` imports and prepend the prefix. Limit recursion depth to 3 levels to avoid infinite loops.

---

### Django REST Framework (DRF)

**Dependency signals:**
- `djangorestframework`, `rest_framework`

**Function-based views:**
```python
@api_view(['GET', 'POST'])
def user_list(request): ...

@api_view(['GET', 'PUT', 'DELETE'])
def user_detail(request, pk): ...
```
Extract methods from the `@api_view([...])` decorator args.

**Class-based API views:**
```python
class UserListView(APIView):
    def get(self, request):  ...   # GET
    def post(self, request): ...   # POST

class UserDetailView(APIView):
    def get(self, request, pk):    ...
    def put(self, request, pk):    ...
    def delete(self, request, pk): ...
```

**ViewSets (most common):**
```python
class UserViewSet(ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
```
A `ModelViewSet` registered with a router generates 6 standard endpoints. A `ReadOnlyModelViewSet` generates 2 (list + retrieve).

**Router registration:**
```python
# urls.py
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'posts', PostViewSet)

urlpatterns = [
    path('api/v1/', include(router.urls)),
]
```

Standard routes from `router.register('users', UserViewSet)` + prefix `api/v1/`:
| Method | Path | Action |
|--------|------|--------|
| GET | /api/v1/users/ | list |
| POST | /api/v1/users/ | create |
| GET | /api/v1/users/{id}/ | retrieve |
| PUT | /api/v1/users/{id}/ | update |
| PATCH | /api/v1/users/{id}/ | partial_update |
| DELETE | /api/v1/users/{id}/ | destroy |

Custom actions via `@action`:
```python
@action(detail=True, methods=['post'])
def activate(self, request, pk=None): ...
# → POST /api/v1/users/{id}/activate/
```

**Serializer-based type info:**
When a ViewSet has `serializer_class = UserSerializer`, look up the serializer class to find fields — these function as the request/response schema. This is bonus information; if the serializer is in a different file, attempt to grep for it but don't fail if not found.

---

### Tornado

**Dependency signals:**
- `tornado`

**Handler pattern:**
```python
class UserHandler(tornado.web.RequestHandler):
    def get(self, user_id):  ...
    def post(self):          ...
    def delete(self, user_id): ...

class MainApp(tornado.web.Application):
    def __init__(self):
        handlers = [
            (r'/users', UserHandler),
            (r'/users/(\d+)', UserHandler),
        ]
```

Extract: find `tornado.web.Application` (or subclass) instantiation with `handlers` list. Each handler entry is `(regex_pattern, HandlerClass)`. For the handler class, extract `get()`, `post()`, `put()`, `delete()`, `patch()` methods.

Path parameter extraction: Tornado uses regex groups — `(\d+)`, `([^/]+)` etc. Normalize to `{param}` (cannot know the parameter name without more context; use positional `{param0}`, `{param1}`).

---

### Sanic

**Dependency signals:**
- `sanic`

**Decorator pattern (similar to Flask):**
```python
app = Sanic("MyApp")

@app.get('/users')
async def list_users(request): ...

@app.post('/users')
async def create_user(request): ...

@app.get('/users/<user_id:int>')
async def get_user(request, user_id): ...
```

Path parameter syntax: `<name:type>` — same normalization as Flask.

**Blueprint:**
```python
bp = Blueprint('users', url_prefix='/users')

@bp.get('/<user_id>')
async def get(request, user_id): ...

app.blueprint(bp, url_prefix='/api/v1')
```

---

## GraphQL

### Graphene (and Graphene-Django)

**Dependency signals:**
- `graphene`, `graphene-django`

**Schema definition:**
```python
import graphene

class Query(graphene.ObjectType):
    user = graphene.Field(UserType, id=graphene.Int(required=True))
    users = graphene.List(UserType)

    def resolve_user(self, info, id):     ...
    def resolve_users(self, info):         ...

class Mutation(graphene.ObjectType):
    create_user = CreateUser.Field()
    delete_user = DeleteUser.Field()

schema = graphene.Schema(query=Query, mutation=Mutation)
```

**Extraction:**
1. Find classes inheriting from `graphene.ObjectType` named `Query`, `Mutation`, `Subscription`
2. For each field defined as `graphene.Field(...)` or `graphene.List(...)`, extract the field name and return type
3. For Mutations, find `graphene.Mutation` subclasses: extract `Arguments` inner class for arg definitions

**Mutation class pattern:**
```python
class CreateUser(graphene.Mutation):
    class Arguments:
        name = graphene.String(required=True)
        email = graphene.String(required=True)

    user = graphene.Field(UserType)

    def mutate(self, info, name, email): ...
```
→ Mutation `createUser(name: String!, email: String!): UserType`

**Type definitions:**
```python
class UserType(graphene.ObjectType):
    class Meta:
        model = User
        fields = ['id', 'name', 'email']
```
These are schema types (equivalent to GraphQL `type User { ... }`). Record as `RawSchemaType` with `typeKind: 'object'`.

---

### Strawberry

**Dependency signals:**
- `strawberry-graphql`, `strawberry-graphql[fastapi]`, `strawberry-graphql[django]`

**Schema definition:**
```python
import strawberry

@strawberry.type
class User:
    id: int
    name: str
    email: str

@strawberry.type
class Query:
    @strawberry.field
    def user(self, id: int) -> User: ...

    @strawberry.field
    def users(self) -> list[User]: ...

@strawberry.type
class Mutation:
    @strawberry.mutation
    def create_user(self, name: str, email: str) -> User: ...

schema = strawberry.Schema(query=Query, mutation=Mutation)
```

**Extraction:**
1. Find classes decorated with `@strawberry.type`
2. Find the class named `Query` or `Mutation` or `Subscription`
3. For each `@strawberry.field` / `@strawberry.mutation` / `@strawberry.subscription` method, extract the operation
4. Method parameters = GraphQL arguments; return type annotation = return type

**Input types:**
```python
@strawberry.input
class CreateUserInput:
    name: str
    email: str
```
Record as `RawSchemaType` with `typeKind: 'input'`.

---

### Ariadne (schema-first)

**Dependency signals:**
- `ariadne`

Ariadne is schema-first: the GraphQL schema is defined in `.graphql` files. Python code binds resolvers to schema fields. The schema files are the primary extraction target — handled by the cross-language `GraphQLSchemaExtractor`.

Python-side binding (for resolver source file location only):
```python
query = QueryType()

@query.field("user")
def resolve_user(*_, id):
    ...
```

---

## RPC

### gRPC (grpcio)

**Dependency signals:**
- `grpcio`, `grpcio-tools`

**Source of truth:** `.proto` files — handled by the cross-language `GrpcProtoExtractor`. The Python extractor's role is to locate `.proto` files and confirm gRPC usage.

**Generated code pattern (for source file location):**
```python
# Generated by grpcio-tools — do not parse
import user_pb2_grpc

class UserServiceServicer(user_pb2_grpc.UserServiceServicer):
    def GetUser(self, request, context): ...
    def CreateUser(self, request, context): ...
```

**Server startup (for service registration):**
```python
server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
user_pb2_grpc.add_UserServiceServicer_to_server(UserServiceImpl(), server)
server.add_insecure_port('[::]:50051')
```

The Python extractor identifies gRPC usage via `grpc.server(` and `add_.*Servicer_to_server` patterns, then delegates to the proto extractor for the actual method list.

**Locating proto files:**
Common locations: `*.proto`, `proto/*.proto`, `protos/*.proto`, `src/proto/*.proto`. If `grpcio-tools` is present and no `.proto` files are found, check if they're in a sibling repo or `git submodule` — emit a warning.

---

### Apache Thrift (Python)

**Dependency signals:**
- `thrift` (PyPI package name)

**Source of truth:** `.thrift` IDL files — same format as Java, handled by the cross-language `ThriftIdlExtractor`.

**Python service implementation:**
```python
class UserServiceHandler:
    def getUser(self, user_id): ...
    def listUsers(self, filter): ...
```

Detect via `thrift` in dependencies; delegate extraction to `ThriftIdlExtractor`.

---

### XML-RPC (stdlib)

**Dependency signals:**
- Uses Python's built-in `xmlrpc` module (no external dependency)
- Tier C signal: `from xmlrpc.server import SimpleXMLRPCServer`

**Pattern:**
```python
from xmlrpc.server import SimpleXMLRPCServer

server = SimpleXMLRPCServer(("localhost", 8000))

def add(x, y): return x + y
def subtract(x, y): return x - y

server.register_function(add, 'add')
server.register_function(subtract, 'subtract')
server.register_instance(MyService())   # all public methods on the instance
```

**Extraction:**
- `server.register_function(func_name, 'exposed_name')` → RPC method `exposed_name`
- `server.register_instance(obj)` → all public methods (not starting with `_`) on the class
- Protocol: `xmlrpc`

---

## Extraction Notes and Edge Cases

### Multi-File Blueprint/Router Registration

Both Flask and FastAPI commonly split route definitions across files and register them in a central `app.py` or `main.py`. The extractor must:
1. Find all `Blueprint(...)` / `APIRouter(...)` assignments across the codebase
2. Find all `register_blueprint(...)` / `include_router(...)` calls
3. Match variable names to build the prefix chain

When a blueprint variable is imported from another module (`from .auth import auth_bp`), follow the import to find its definition.

### Async Views

`async def get_user(...)` is functionally identical to `def get_user(...)` from an API definition standpoint. No special handling needed.

### Type Hints and Response Models

FastAPI's `response_model=UserResponse` and Pydantic type hints provide machine-readable response type information. Extract the type name as `returnType`. The actual Pydantic model fields are not extracted (too deep for the current scope) — just the class name.

### Django URL Namespacing

```python
app_name = 'users'
urlpatterns = [
    path('list/', views.list_view, name='list'),  # → 'users:list'
]
```
The `app_name` namespace is Django-internal routing metadata. Do not include in the extracted path.

### Starlette (FastAPI dependency)

FastAPI is built on Starlette. Some projects use Starlette directly:
```python
from starlette.routing import Route
routes = [
    Route('/users', list_users),
    Route('/users/{user_id}', get_user),
]
```
Detect via `starlette` in dependencies; extraction is similar to FastAPI route objects.

### APIRouter with `dependencies=`

```python
router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)],   # auth dependency
)
```
The `tags` value → `tags` field on all endpoints from this router. The `dependencies` → skip (it's middleware, not a parameter).

### Pydantic v1 vs v2

FastAPI works with both Pydantic v1 (`class Config`) and v2 (`model_config`). This does not affect route extraction — only affects how body types might be described. No special handling needed for the current extraction scope.
