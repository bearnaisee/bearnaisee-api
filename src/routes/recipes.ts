import { getRepository } from "typeorm";
import { Application, Request, Response } from "express";
import { Recipes } from "../entities/Recipes";
import { Users } from "../entities/Users";
import { slugGenerator } from "../helpers/recipe/slugGenerator";
import upsertTags from "../helpers/tags/upsertTag";
import createRecipeTags from "../helpers/recipe/createRecipeTags";
import { generateRandomString } from "../helpers/generateRandomString";
import createRecipeSteps from "../helpers/recipe/createRecipeSteps";
import { RecipeHasIngredients } from "../entities/RecipeHasIngredients";

export default (server: Application) => {
  server.post("/recipe", async (req: Request, res: Response) => {
    const user = await getRepository(Users).findOne({
      id: req?.body?.userId,
    });

    if (!user) {
      return res.status(200).send({ msg: "Couldn't find user with that id" });
    }

    const recipe = new Recipes();
    recipe.userId = user.id;
    recipe.title = `${req?.body?.title?.trim()}${generateRandomString()}`;
    recipe.slug = `${req?.body?.slug || slugGenerator(req?.body?.title)}-${generateRandomString()}`;
    recipe.description = req?.body?.description;
    recipe.coverImage = req?.body?.coverImage;
    recipe.public = req?.body?.public || true;
    recipe.estimatedTime = req?.body?.estimatedTime || null;
    recipe.createdAt = req?.body?.createdAt || new Date();
    recipe.editedAt = new Date();

    const savedRecipe = await getRepository(Recipes)
      .save({
        ...recipe,
      })
      .catch((error) => console.error("Error saving recipe", error));
    console.log("recipe,", savedRecipe);

    if (!savedRecipe) {
      return res.status(400).send({
        msg: "Error saving recipe",
        recipe: savedRecipe,
      });
    }

    if (req?.body?.steps?.length) {
      await createRecipeSteps(savedRecipe, req?.body?.steps);
    }

    // create any missing tags
    const recipeTags = req?.body?.tags?.length ? await upsertTags(req?.body?.tags) : [];

    // create the join tables
    if (recipeTags?.length) {
      await createRecipeTags(savedRecipe, recipeTags);
    }

    if (req?.body?.ingredients?.length) {
      const validIngredients = req?.body?.ingredients?.filter((i) => i?.metricId && i?.ingredientId && i?.amount);

      if (validIngredients?.length) {
        validIngredients.forEach(async (ingredient) => {
          const newIngredient = getRepository(RecipeHasIngredients).create({
            recipeId: savedRecipe.id,
            amount: ingredient.amount,
            metricId: ingredient.metricId,
            ingredientId: ingredient.ingredientId,
          });

          await getRepository(RecipeHasIngredients).save(newIngredient);
        });
      }
    }

    return res.status(200).send({ msg: "No errors", recipe: savedRecipe });
  });

  server.get("/recipe/:username/:slug", async (req: Request, res: Response) => {
    const user = await getRepository(Users).findOne({
      username: req.params.username.toLowerCase(),
    });

    if (!user) {
      return res.status(404).send({
        msg: "User not found",
      });
    }

    const recipe = await getRepository(Recipes)
      .createQueryBuilder("recipe")
      .where("recipe.userId = :userId", {
        userId: user.id,
      })
      .andWhere("recipe.slug = :slug", {
        slug: req.params.slug,
      })
      .leftJoinAndSelect("recipe.recipeSteps", "recipeSteps")
      .leftJoinAndSelect("recipe.recipeHasIngredients", "recipeHasIngredients")
      .leftJoinAndSelect("recipeHasIngredients.ingredient", "ingredients")
      .leftJoinAndSelect("recipeHasIngredients.metric", "metric")
      .leftJoinAndSelect("recipe.recipeComments", "recipeComments")
      .leftJoinAndSelect("recipe.recipeHasTags", "recipeHasTags")
      .leftJoinAndSelect("recipeHasTags.tag", "recipeTags")
      .getOne();

    if (recipe) {
      return res.status(200).send({
        ...recipe,
        recipeHasTags: undefined,
        recipeHasIngredients: undefined,
        tags: recipe?.recipeHasTags?.map((recipeTag) => recipeTag?.tag),
        ingredients: recipe?.recipeHasIngredients?.map((recipeIngredient) => ({
          ...recipeIngredient,
          ingredient: recipeIngredient?.ingredient?.ingredient,
          metric: recipeIngredient?.metric?.metric,
        })),
      });
    }

    return res.status(404).send({
      msg: "Recipe not found",
    });
  });

  server.get("/recipes/recent", async (req: Request, res: Response) => {
    // don't ask
    const take = req?.query?.take ? parseInt(req?.query?.take.toString(), 10) : 20;
    const skip = req?.query?.skip ? parseInt(req?.query?.skip.toString(), 10) : 0;

    const recipes = await getRepository(Recipes)
      .createQueryBuilder("recipe")
      .leftJoinAndSelect("recipe.user", "user")
      .leftJoinAndSelect("recipe.recipeHasTags", "recipeHasTags")
      .leftJoinAndSelect("recipeHasTags.tag", "recipeTags")
      .skip(skip)
      .limit(take)
      .getMany();

    res.status(200).send({
      recipes: recipes?.map((r) => ({
        ...r,
        author: r?.user?.username,
        user: undefined,
        recipeHasTags: undefined,
        tags: r?.recipeHasTags?.map((rt) => rt?.tag),
      })),
    });
  });

  server.delete("/recipe/:recipeId", async (req: Request, res: Response) => {
    const result = await getRepository(Recipes)
      .createQueryBuilder()
      .delete()
      .where("id = :recipeId")
      .setParameters({ recipeId: parseInt(req?.params?.recipeId, 10) })
      .execute();

    res.status(200).send({ result });
  });
};