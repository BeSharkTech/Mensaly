type Validator<T> = (value: unknown) => T;
type Handler<TInput, TResult> = (args: {
  data: TInput;
}) => TResult | Promise<TResult>;

export function createServerFn(_options: { method: "GET" | "POST" }) {
  return {
    inputValidator<TInput>(validator: Validator<TInput>) {
      return {
        handler<TResult>(handler: Handler<TInput, TResult>) {
          return async ({ data }: { data: TInput }) =>
            handler({ data: validator(data) });
        },
      };
    },
  };
}

export function useServerFn<T>(fn: T): T {
  return fn;
}
