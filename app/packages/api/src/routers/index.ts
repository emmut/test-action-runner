import { protectedProcedure, publicProcedure, router } from "../index";
import { ticketRouter } from "./ticket";
import { todoRouter } from "./todo";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  todo: todoRouter,
  ticket: ticketRouter,
});
export type AppRouter = typeof appRouter;
