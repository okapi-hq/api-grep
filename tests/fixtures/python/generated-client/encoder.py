import pydantic


def to_jsonable(obj, custom_encoder=None):
    # a generated SDK's encoder: it calls itself on what a model dumps, unwrapping a root model first
    custom_encoder = custom_encoder or {}
    if isinstance(obj, pydantic.BaseModel):
        obj_dict = obj.dict(by_alias=True)
        if "__root__" in obj_dict:
            obj_dict = obj_dict["__root__"]
        if "root" in obj_dict:
            obj_dict = obj_dict["root"]
        return to_jsonable(obj_dict, custom_encoder=custom_encoder)
    if isinstance(obj, dict):
        return {to_jsonable(k, custom_encoder=custom_encoder): to_jsonable(v, custom_encoder=custom_encoder) for k, v in obj.items()}
    return obj
